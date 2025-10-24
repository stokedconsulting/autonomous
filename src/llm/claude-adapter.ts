/**
 * Claude LLM Adapter
 */

import { $ } from 'zx';
import { promises as fs } from 'fs';
import { join } from 'path';
import { LLMAdapter, LLMStatus, StartLLMOptions } from './adapter.js';
import { LLMConfig } from '../types/index.js';

interface ClaudeInstance {
  instanceId: string;
  processId: number;
  startedAt: string;
  assignmentId: string;
  worktreePath: string;
}

export class ClaudeAdapter implements LLMAdapter {
  readonly provider = 'claude' as const;
  private config: LLMConfig;
  private instances = new Map<string, ClaudeInstance>();
  private autonomousDataDir: string;

  constructor(config: LLMConfig, autonomousDataDir: string) {
    this.config = config;
    this.autonomousDataDir = autonomousDataDir;
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
    }

    // Write the prompt to a file
    const promptFile = join(this.autonomousDataDir, `prompt-${instanceId}.txt`);
    await fs.writeFile(promptFile, prompt, 'utf-8');

    // Start Claude in the worktree directory
    // We'll use a background process approach
    const cliPath = this.config.cliPath || 'claude';
    const cliArgs = this.config.cliArgs || [];
    const cliArgsString = cliArgs.length > 0 ? ' ' + cliArgs.join(' ') : '';

    // Create a script to run Claude with the prompt
    // Use user's shell to ensure PATH is set correctly
    const userShell = process.env.SHELL || '/bin/bash';
    const scriptPath = join(this.autonomousDataDir, `start-${instanceId}.sh`);
    const logFile = join(this.autonomousDataDir, `output-${instanceId}.log`);
    const script = `#!${userShell}
cd "${workingDirectory}"
LOG_FILE="${logFile}"
echo "=== Claude Autonomous Session Started: \$(date) ===" > "\$LOG_FILE"
echo "Working Directory: ${workingDirectory}" >> "\$LOG_FILE"
echo "Instance ID: ${instanceId}" >> "\$LOG_FILE"
echo "========================================" >> "\$LOG_FILE"
echo "" >> "\$LOG_FILE"
cat "${promptFile}" | ${cliPath}${cliArgsString} chat 2>&1 | tee -a "\$LOG_FILE"
`;

    await fs.writeFile(scriptPath, script, 'utf-8');
    await fs.chmod(scriptPath, 0o755);

    // For now, we'll create a marker that indicates Claude should be run
    // In a real implementation, you'd spawn this as a background process
    // and manage it via process management

    const instance: ClaudeInstance = {
      instanceId,
      processId: process.pid, // Placeholder
      startedAt: new Date().toISOString(),
      assignmentId: assignment.id,
      worktreePath: workingDirectory,
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

    // In a real implementation, terminate the process
    // For now, just remove from tracking

    this.instances.delete(instanceId);

    // Clean up instance files
    const instanceFile = join(this.autonomousDataDir, `instance-${instanceId}.json`);
    try {
      await fs.unlink(instanceFile);
    } catch {
      // Ignore if file doesn't exist
    }
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

    // Check if session data exists
    const sessionFile = join(this.autonomousDataDir, `session-${instanceId}.json`);
    let lastActivity: string | undefined;

    try {
      const sessionData = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));
      lastActivity = sessionData.lastActivity;
    } catch {
      // No session data yet
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
   */
  async installHooks(worktreePath: string, assignmentId: string): Promise<void> {
    const hooksDir = join(worktreePath, '.claude', 'hooks');

    // Ensure hooks directory exists
    await fs.mkdir(hooksDir, { recursive: true });

    // Create session-end hook
    const sessionEndHook = this.generateSessionEndHook(assignmentId);
    const sessionEndPath = join(hooksDir, 'autonomous-session-end.sh');
    await fs.writeFile(sessionEndPath, sessionEndHook, 'utf-8');
    await fs.chmod(sessionEndPath, 0o755);

    // Create tool-use hook to track activity
    const toolUseHook = this.generateToolUseHook(assignmentId);
    const toolUsePath = join(hooksDir, 'on-tool-use.sh');
    await fs.writeFile(toolUsePath, toolUseHook, 'utf-8');
    await fs.chmod(toolUsePath, 0o755);
  }

  /**
   * Get the last work summary
   */
  async getLastSummary(instanceId: string): Promise<string | null> {
    const sessionFile = join(this.autonomousDataDir, `session-${instanceId}.json`);

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
   * Generate session end hook script
   */
  private generateSessionEndHook(assignmentId: string): string {
    return `#!/bin/bash
# Autonomous session end hook
# This hook is called when a Claude work session ends

ASSIGNMENT_ID="${assignmentId}"
AUTONOMOUS_DATA_DIR="${this.autonomousDataDir}"
SESSION_FILE="\${AUTONOMOUS_DATA_DIR}/session-\${CLAUDE_INSTANCE_ID:-unknown}.json"

# Create session data
cat > "\$SESSION_FILE" <<EOF
{
  "assignmentId": "\$ASSIGNMENT_ID",
  "endedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "lastActivity": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "summary": "Work session completed",
  "workingDirectory": "$(pwd)"
}
EOF

echo "Session data saved to \$SESSION_FILE"
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
    const instanceFile = join(this.autonomousDataDir, `instance-${instanceId}.json`);
    await fs.writeFile(instanceFile, JSON.stringify(instance, null, 2), 'utf-8');
  }
}
