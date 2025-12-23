
import { $ } from 'zx';
import { promises as fs } from 'fs';
import { join } from 'path';
import { LLMAdapter, LLMStatus, StartLLMOptions } from './adapter.js';
import { LLMConfig } from '../types/index.js';
import { CLIPTYExecutor } from './cli-pty-executor.js';
import { resolveCliArgs, resolveCliPath } from './cli-defaults.js';
import { isProcessRunning } from '../utils/process.js';

interface CodexInstance {
  instanceId: string;
  processId: number;
  startedAt: string;
  assignmentId: string;
  worktreePath: string;
  executor?: CLIPTYExecutor;
}

export class CodexAdapter implements LLMAdapter {
  readonly provider = 'codex' as const;
  private config: LLMConfig;
  private autonomousDataDir: string;
  private verbose: boolean;
  private instances = new Map<string, CodexInstance>();

  constructor(config: LLMConfig, autonomousDataDir: string, verbose: boolean = false) {
    this.config = config;
    this.autonomousDataDir = autonomousDataDir;
    this.verbose = verbose;
  }

  async start(options: StartLLMOptions): Promise<string> {
    const { assignment, prompt, workingDirectory } = options;
    const instanceId = assignment.llmInstanceId;

    await fs.mkdir(this.getSubdirectory('logs'), { recursive: true });
    await fs.mkdir(this.getSubdirectory('sessions'), { recursive: true });

    const logFile = join(this.getSubdirectory('logs'), `output-${instanceId}.log`);
    const cliPath = resolveCliPath('codex', this.config.cliPath);
    const cliArgs = resolveCliArgs('codex', this.config.cliArgs);

    const logHeader = `=== Codex Autonomous Session Starting ===\nInstance ID: ${instanceId}\nWorking Directory: ${workingDirectory}\nStarted: ${new Date().toISOString()}\n=======================================\n\n`;
    await fs.writeFile(logFile, logHeader, 'utf-8');

    const executor = new CLIPTYExecutor();
    const promptDelayMs = typeof this.config.customConfig?.promptDelayMs === 'number'
      ? this.config.customConfig.promptDelayMs
      : undefined;
    const enterDelayMs = typeof this.config.customConfig?.enterDelayMs === 'number'
      ? this.config.customConfig.enterDelayMs
      : undefined;
    const stripInputEcho = typeof this.config.customConfig?.stripInputEcho === 'boolean'
      ? this.config.customConfig.stripInputEcho
      : undefined;
    const startPromise = executor.start({
      command: cliPath,
      args: cliArgs,
      promptText: prompt,
      workingDirectory,
      logFile,
      instanceId,
      onData: this.verbose ? (data: string) => process.stdout.write(data) : undefined,
      promptDelayMs,
      enterDelayMs,
      stripInputEcho,
    });

    const pid = executor.getPid();

    startPromise.catch((error) => {
      console.error(`\n❌ Codex execution failed: ${error.message}`);
    });

    const instance: CodexInstance = {
      instanceId,
      processId: pid || 0,
      startedAt: new Date().toISOString(),
      assignmentId: assignment.id,
      worktreePath: workingDirectory,
      executor,
    };

    this.instances.set(instanceId, instance);
    await this.saveInstanceInfo(instanceId, instance);

    return instanceId;
  }

  async stop(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    if (instance.executor) {
      instance.executor.stop();
    } else if (instance.processId) {
      try {
        process.kill(-instance.processId, 'SIGTERM');
      } catch (error) {
        console.warn(`Could not kill process ${instance.processId}:`, error);
      }
    }

    this.instances.delete(instanceId);

    const instanceFile = join(this.getSubdirectory('sessions'), `instance-${instanceId}.json`);
    try {
      await fs.unlink(instanceFile);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async getStatus(instanceId: string): Promise<LLMStatus> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return {
        instanceId,
        provider: 'codex',
        isRunning: false,
      };
    }

    let lastActivity: string | undefined;
    try {
      const logFile = join(this.getSubdirectory('logs'), `output-${instanceId}.log`);
      const stats = await fs.stat(logFile);
      lastActivity = stats.mtime.toISOString();
    } catch {
      // Ignore missing log file
    }

    const running =
      (instance.executor && instance.executor.isRunning()) ||
      (instance.processId ? isProcessRunning(instance.processId) : false);

    return {
      instanceId,
      provider: 'codex',
      isRunning: running,
      startedAt: instance.startedAt,
      lastActivity,
      processId: instance.processId,
    };
  }

  async isInstalled(): Promise<boolean> {
    try {
      const cliPath = resolveCliPath('codex', this.config.cliPath);
      try {
        await $`which ${cliPath}`;
        return true;
      } catch {
        try {
          await $`command -v ${cliPath}`;
          return true;
        } catch {
          const shell = process.env.SHELL || '/bin/bash';
          await $`${shell} -l -c "which ${cliPath}"`;
          return true;
        }
      }
    } catch {
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const cliPath = resolveCliPath('codex', this.config.cliPath);
      const result = await $`${cliPath} --version`;
      return result.stdout.trim();
    } catch {
      return null;
    }
  }

  supportsHooks(): boolean {
    return false;
  }

  async installHooks(_worktreePath: string, _assignmentId: string): Promise<void> {
    // No-op
  }

  async getLastSummary(_instanceId: string): Promise<string | null> {
    return null;
  }

  private getSubdirectory(type: 'sessions' | 'logs'): string {
    return join(this.autonomousDataDir, type);
  }

  private async saveInstanceInfo(instanceId: string, instance: CodexInstance): Promise<void> {
    const instanceFile = join(this.getSubdirectory('sessions'), `instance-${instanceId}.json`);
    await fs.writeFile(instanceFile, JSON.stringify(instance, null, 2), 'utf-8');
  }
}
