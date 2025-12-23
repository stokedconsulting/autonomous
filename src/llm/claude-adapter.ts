/**
 * Claude LLM Adapter
 */

import { $ } from 'zx';
import { promises as fs } from 'fs';
import { join } from 'path';
import { LLMAdapter, LLMStatus, StartLLMOptions } from './adapter.js';
import { LLMConfig } from '../types/index.js';
import { ClaudePTYExecutor } from './claude-pty-executor.js';
import { ClaudePrintExecutor } from './claude-print-executor.js';

interface ClaudeInstance {
  instanceId: string;
  processId: number;
  startedAt: string;
  assignmentId: string;
  worktreePath: string;
  executor?: ClaudePTYExecutor | ClaudePrintExecutor;
  mode?: 'pty' | 'print';
}

export class ClaudeAdapter implements LLMAdapter {
  readonly provider = 'claude' as const;
  private config: LLMConfig;
  private instances = new Map<string, ClaudeInstance>();
  private autonomousDataDir: string;
  private verbose: boolean;

  constructor(config: LLMConfig, autonomousDataDir: string, verbose: boolean = false) {
    this.config = config;
    this.autonomousDataDir = autonomousDataDir;
    this.verbose = verbose;
  }

  /**
   * Get subdirectory paths within .autonomous/
   */
  private getSubdirectory(type: 'sessions' | 'logs' | 'hooks' | 'prompts'): string {
    return join(this.autonomousDataDir, type);
  }

  /**
   * Start a Claude instance
   */
  async start(options: StartLLMOptions): Promise<string> {
    const { assignment, prompt, workingDirectory } = options;
    const instanceId = assignment.llmInstanceId;

    // Install hooks if enabled
    if (this.config.hooksEnabled) {
      await this.installHooks(workingDirectory, assignment.id);
      await this.installSessionEndHook(workingDirectory);
    }

    // Ensure subdirectories exist
    await fs.mkdir(this.getSubdirectory('prompts'), { recursive: true });
    await fs.mkdir(this.getSubdirectory('logs'), { recursive: true });

    const logFile = join(this.getSubdirectory('logs'), `output-${instanceId}.log`);
    const cliPath = this.config.cliPath || 'claude';

    // Create log header
    const logHeader = `=== Claude Autonomous Session Starting ===\nInstance ID: ${instanceId}\nWorking Directory: ${workingDirectory}\nStarted: ${new Date().toISOString()}\n========================================\n\n`;
    await fs.writeFile(logFile, logHeader, 'utf-8');

    let pid: number | undefined;
    let executor: ClaudePTYExecutor | ClaudePrintExecutor;
    let mode: 'pty' | 'print';

    if (this.verbose) {
      // PTY mode - real-time streaming with interactive terminal
      mode = 'pty';
      const ptyExecutor = new ClaudePTYExecutor();

      ptyExecutor.on('exit', ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        if (signal) {
          console.log(`\n⚠️  Claude session terminated by signal ${signal}`);
        } else {
          console.log(`\n✨ Claude session completed (exit code: ${exitCode})`);
        }
      });

      // Start PTY execution (this will block until completion)
      const startPromise = ptyExecutor.start({
        promptText: prompt,
        workingDirectory,
        logFile,
        instanceId,
        claudePath: cliPath,
        onData: (data: string) => {
          // Real-time output to console
          process.stdout.write(data);
        },
      });

      pid = ptyExecutor.getPid();
      executor = ptyExecutor;

      // Don't await - let it run in background
      startPromise.catch((error) => {
        console.error(`\n❌ Claude PTY execution failed: ${error.message}`);
      });
    } else {
      // Print mode - silent background execution
      mode = 'print';
      const printExecutor = new ClaudePrintExecutor();

      // Start print execution (this will block until completion)
      const startPromise = printExecutor.start({
        promptText: prompt,
        workingDirectory,
        logFile,
        instanceId,
        claudePath: cliPath,
      });

      pid = printExecutor.getPid();
      executor = printExecutor;

      // Don't await - let it run in background
      startPromise.catch((error) => {
        console.error(`\n❌ Claude print execution failed: ${error.message}`);
      });
    }

    const instance: ClaudeInstance = {
      instanceId,
      processId: pid || 0,
      startedAt: new Date().toISOString(),
      assignmentId: assignment.id,
      worktreePath: workingDirectory,
      executor,
      mode,
    };

    this.instances.set(instanceId, instance);

    // Write instance info
    await this.saveInstanceInfo(instanceId, instance);

    return instanceId;
  }

  /**
   * Stop a Claude instance
   */
  async stop(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    // Stop executor if present
    if (instance.executor) {
      instance.executor.stop();
    } else if (instance.processId) {
      // Fallback: terminate the process directly
      try {
        // Kill the process group (negative PID kills the group)
        process.kill(-instance.processId, 'SIGTERM');
      } catch (error) {
        // Process may have already exited, ignore
        console.warn(`Could not kill process ${instance.processId}:`, error);
      }
    }

    this.instances.delete(instanceId);

    // Clean up instance files from sessions directory
    const instanceFile = join(this.getSubdirectory('sessions'), `instance-${instanceId}.json`);
    try {
      await fs.unlink(instanceFile);
    } catch {
      // Ignore if file doesn't exist
    }

    // Clean up session files
    await this.cleanupSessionFiles(instanceId);
  }

  /**
   * Get status of a Claude instance
   */
  async getStatus(instanceId: string): Promise<LLMStatus> {
    const instance = this.instances.get(instanceId);

    if (!instance) {
      return {
        instanceId,
        provider: 'claude',
        isRunning: false,
      };
    }

    let lastActivity: string | undefined;

    // Check for Stop signal - Claude finished responding and waiting for input
    const stopSignalFile = join(this.autonomousDataDir, `stop-signal-${instanceId}.json`);
    let hasStopSignal = false;

    try {
      const stopData = JSON.parse(await fs.readFile(stopSignalFile, 'utf-8'));
      hasStopSignal = true;
      lastActivity = stopData.stoppedAt;
    } catch {
      // No stop signal yet - Claude is still working
    }

    // If stop signal exists, Claude has finished responding
    // Mark as not running so orchestrator processes completion
    if (hasStopSignal) {
      return {
        instanceId,
        provider: 'claude',
        isRunning: false,
        startedAt: instance.startedAt,
        lastActivity,
        processId: instance.processId,
      };
    }

    // Check activity log for recent tool usage
    const activityFile = join(this.autonomousDataDir, `activity-${instanceId}.log`);
    try {
      const activityLog = await fs.readFile(activityFile, 'utf-8');
      const lines = activityLog.trim().split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        // Parse last activity timestamp
        const lastLine = lines[lines.length - 1];
        const match = lastLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
        if (match) {
          lastActivity = match[1];
        }
      }
    } catch {
      // No activity log yet - Claude hasn't used any tools
    }

    // Fallback: Check if process is actually running (in case hook didn't run)
    const { isProcessRunning } = await import('../utils/process.js');
    const processRunning = await isProcessRunning(instance.processId);

    if (!processRunning) {
      // Process ended but hook didn't create stop signal file
      return {
        instanceId,
        provider: 'claude',
        isRunning: false,
        startedAt: instance.startedAt,
        lastActivity,
        processId: instance.processId,
      };
    }

    return {
      instanceId,
      provider: 'claude',
      isRunning: true,
      startedAt: instance.startedAt,
      lastActivity,
      processId: instance.processId,
    };
  }

  /**
   * Check if Claude supports hooks
   */
  supportsHooks(): boolean {
    return true;
  }

  /**
   * Install hooks for Claude
   * Uses Claude Code's hook system via settings.json
   */
  async installHooks(worktreePath: string, assignmentId: string): Promise<void> {
    const claudeDir = join(worktreePath, '.claude');
    const hooksDir = join(claudeDir, 'hooks');

    // Ensure directories exist
    await fs.mkdir(hooksDir, { recursive: true });

    // Create Stop hook script - fires when Claude finishes responding
    const stopHook = this.generateStopHook(assignmentId);
    const stopHookPath = join(hooksDir, 'autonomous-stop.sh');
    await fs.writeFile(stopHookPath, stopHook, 'utf-8');
    await fs.chmod(stopHookPath, 0o755);

    // Create tool-use hook script to track activity
    const toolUseHook = this.generateToolUseHook(assignmentId);
    const toolUsePath = join(hooksDir, 'autonomous-tool-use.sh');
    await fs.writeFile(toolUsePath, toolUseHook, 'utf-8');
    await fs.chmod(toolUsePath, 0o755);

    // Create or update settings.json to register hooks with Claude Code
    const settingsPath = join(claudeDir, 'settings.json');
    let settings: Record<string, any> = {};

    try {
      const existingSettings = await fs.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(existingSettings);
    } catch {
      // No existing settings
    }

    // Configure hooks in settings.json format
    // Use empty string matcher to match all events
    settings.hooks = {
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: stopHookPath,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: toolUsePath,
            },
          ],
        },
      ],
    };

    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  /**
   * Install session-end hook for automatic PTY exit
   */
  private async installSessionEndHook(workingDir: string): Promise<void> {
    const hookScript = `#!/usr/bin/env bash
# Auto-exit hook for PTY-based Claude sessions

# Check if we're running as child of autonomous tool
if [[ -n "$AUTONOMOUS_PARENT_PID" ]]; then
  # Wait 4 seconds for final output to flush
  sleep 4

  # Exit cleanly
  echo ""
  echo "🤖 Autonomous session complete - exiting..."
  exit 0
fi
`;

    const hooksDir = join(workingDir, '.claude', 'hooks');
    const hookPath = join(hooksDir, 'session-end.sh');

    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(hookPath, hookScript, 'utf-8');
    await fs.chmod(hookPath, 0o755);
  }

  /**
   * Get the last work summary
   */
  async getLastSummary(instanceId: string): Promise<string | null> {
    const sessionFile = join(this.getSubdirectory('sessions'), `session-${instanceId}.json`);

    try {
      const data = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));
      return data.summary || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if Claude CLI is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      const cliPath = this.config.cliPath || 'claude';

      // Try which command (works better across different shells)
      try {
        await $`which ${cliPath}`;
        return true;
      } catch {
        // Fallback to command -v
        try {
          await $`command -v ${cliPath}`;
          return true;
        } catch {
          // Try with user's shell
          const shell = process.env.SHELL || '/bin/bash';
          await $`${shell} -l -c "which ${cliPath}"`;
          return true;
        }
      }
    } catch {
      return false;
    }
  }

  /**
   * Get Claude CLI version
   */
  async getVersion(): Promise<string | null> {
    try {
      const cliPath = this.config.cliPath || 'claude';
      const result = await $`${cliPath} --version`;
      return result.stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Generate Stop hook script - fires when Claude finishes responding
   * This is the key hook for autonomous operation
   */
  private generateStopHook(assignmentId: string): string {
    return `#!/bin/bash
# Autonomous Stop hook - fires when Claude finishes responding
# This signals that Claude has completed its response and is waiting for input

ASSIGNMENT_ID="${assignmentId}"
AUTONOMOUS_DATA_DIR="${this.autonomousDataDir}"
STOP_SIGNAL_FILE="\${AUTONOMOUS_DATA_DIR}/stop-signal-\${CLAUDE_INSTANCE_ID:-unknown}.json"

# Read hook input from stdin
HOOK_INPUT=$(cat)

# Extract stop_hook_active to prevent infinite loops
STOP_HOOK_ACTIVE=$(echo "\$HOOK_INPUT" | grep -o '"stop_hook_active":[^,}]*' | cut -d':' -f2 | tr -d ' ')

# Create stop signal file for the orchestrator to detect
cat > "\$STOP_SIGNAL_FILE" <<EOF
{
  "assignmentId": "\$ASSIGNMENT_ID",
  "stoppedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "stopHookActive": \${STOP_HOOK_ACTIVE:-false},
  "workingDirectory": "$(pwd)"
}
EOF

# Exit 0 to allow Claude to stop (orchestrator will kill process)
exit 0
`;
  }

  /**
   * Generate tool use hook script
   */
  private generateToolUseHook(assignmentId: string): string {
    return `#!/bin/bash
# Track tool usage for activity monitoring

ASSIGNMENT_ID="${assignmentId}"
AUTONOMOUS_DATA_DIR="${this.autonomousDataDir}"
ACTIVITY_FILE="\${AUTONOMOUS_DATA_DIR}/activity-\${CLAUDE_INSTANCE_ID:-unknown}.log"

# Log tool activity
echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") - Tool: \${TOOL_NAME:-unknown}" >> "\$ACTIVITY_FILE"
`;
  }

  /**
   * Save instance information
   */
  private async saveInstanceInfo(instanceId: string, instance: ClaudeInstance): Promise<void> {
    const instanceFile = join(this.getSubdirectory('sessions'), `instance-${instanceId}.json`);
    await fs.writeFile(instanceFile, JSON.stringify(instance, null, 2), 'utf-8');
  }

  /**
   * Clean up session files after stop
   */
  private async cleanupSessionFiles(instanceId: string): Promise<void> {
    const filesToCleanup = [
      join(this.getSubdirectory('sessions'), `start-${instanceId}.sh`),
      join(this.getSubdirectory('sessions'), `session-${instanceId}.json`),
      join(this.getSubdirectory('prompts'), `prompt-${instanceId}.txt`),
      join(this.getSubdirectory('logs'), `output-${instanceId}.log`),
      join(this.autonomousDataDir, `stop-signal-${instanceId}.json`),
      join(this.autonomousDataDir, `activity-${instanceId}.log`),
    ];

    for (const file of filesToCleanup) {
      try {
        await fs.unlink(file);
      } catch {
        // Ignore if file doesn't exist
      }
    }
  }
}
