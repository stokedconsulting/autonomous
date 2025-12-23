/**
 * CLI PTY Executor - Runs an arbitrary CLI in a pseudo-terminal.
 *
 * Designed for LLM CLIs that expect a TTY but can accept prompts via stdin.
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { createWriteStream, WriteStream } from 'fs';

export interface CLIPTYExecutorOptions {
  command: string;
  args: string[];
  promptText: string;
  workingDirectory: string;
  logFile: string;
  instanceId: string;
  onData?: (data: string) => void;
  cols?: number;
  rows?: number;
  env?: NodeJS.ProcessEnv;
  promptDelayMs?: number;
  enterDelayMs?: number;
  stripInputEcho?: boolean;
}

export class CLIPTYExecutor extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private logStream: WriteStream | null = null;
  private isActive = false;
  private hasSentPrompt = false;
  private promptTimer: NodeJS.Timeout | null = null;
  private pendingEcho: string = '';
  private echoPrefix: string = '';
  private echoStarted = false;
  private stripInputEcho = false;
  private echoTimeout: NodeJS.Timeout | null = null;

  /**
   * Start CLI in PTY mode with optional prompt delay.
   */
  async start(options: CLIPTYExecutorOptions): Promise<number> {
    const {
      command,
      args,
      promptText,
      workingDirectory,
      logFile,
      instanceId,
      onData,
      cols = process.stdout.columns || 120,
      rows = process.stdout.rows || 40,
      env,
      promptDelayMs = 1500,
      enterDelayMs = 400,
      stripInputEcho = true,
    } = options;

    this.isActive = true;
    this.stripInputEcho = stripInputEcho;
    this.pendingEcho = stripInputEcho ? promptText : '';
    this.echoPrefix = stripInputEcho ? promptText.trimStart().slice(0, 24) : '';
    this.echoStarted = false;

    this.logStream = createWriteStream(logFile, { flags: 'a' });

    this.ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...env,
        AUTONOMOUS_INSTANCE_ID: instanceId,
        AUTONOMOUS_PARENT_PID: process.pid.toString(),
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
    });

    const sendPrompt = () => {
      if (this.hasSentPrompt || !this.isActive || !this.ptyProcess) {
        return;
      }
      this.hasSentPrompt = true;
      this.ptyProcess.write(promptText);
      setTimeout(() => {
        if (this.isActive && this.ptyProcess) {
          this.ptyProcess.write('\r');
        }
      }, enterDelayMs);
      if (this.stripInputEcho && this.pendingEcho) {
        this.echoTimeout = setTimeout(() => {
          if (!this.echoStarted) {
            this.pendingEcho = '';
          }
        }, 3000);
      }
    };

    this.promptTimer = setTimeout(sendPrompt, promptDelayMs);

    this.ptyProcess.onData((data: string) => {
      const output = this.stripEcho(data);

      if (this.logStream) {
        this.logStream.write(output);
      }

      if (onData) {
        onData(output);
      }
    });

    return new Promise((resolve, reject) => {
      this.ptyProcess?.onExit(({ exitCode, signal }) => {
        if (this.logStream) {
          const exitInfo = `\n\n=== Session Ended ===\nExit code: ${exitCode}\nSignal: ${signal}\nEnded: ${new Date().toISOString()}\n`;
          this.logStream.write(exitInfo);
        }

        this.cleanup();

        if (signal) {
          this.emit('exit', { exitCode: exitCode ?? 1, signal });
          reject(new Error(`CLI process killed by signal ${signal}`));
        } else {
          this.emit('exit', { exitCode: exitCode ?? 0 });
          resolve(exitCode ?? 0);
        }
      });
    });
  }

  /**
   * Stop the PTY process.
   */
  stop(): void {
    this.isActive = false;
    if (this.promptTimer) {
      clearTimeout(this.promptTimer);
      this.promptTimer = null;
    }
    if (this.echoTimeout) {
      clearTimeout(this.echoTimeout);
      this.echoTimeout = null;
    }
    if (this.ptyProcess) {
      this.ptyProcess.kill();
    }
  }

  /**
   * Get the process ID.
   */
  getPid(): number | undefined {
    return this.ptyProcess?.pid;
  }

  /**
   * Check if process is running.
   */
  isRunning(): boolean {
    return this.isActive && this.ptyProcess != null;
  }

  private stripEcho(data: string): string {
    if (!this.stripInputEcho || !this.pendingEcho) {
      return data;
    }

    let output = '';
    let startIndex = 0;

    if (!this.echoStarted && this.echoPrefix) {
      const prefixIndex = data.indexOf(this.echoPrefix);
      if (prefixIndex === -1) {
        return data;
      }
      output += data.slice(0, prefixIndex);
      startIndex = prefixIndex;
      this.echoStarted = true;
    }

    const chunk = data.slice(startIndex);
    for (const char of chunk) {
      if (this.pendingEcho.length > 0 && char === this.pendingEcho[0]) {
        this.pendingEcho = this.pendingEcho.slice(1);
        continue;
      }
      output += char;
    }

    return output;
  }

  private cleanup(): void {
    this.isActive = false;

    if (this.promptTimer) {
      clearTimeout(this.promptTimer);
      this.promptTimer = null;
    }
    if (this.echoTimeout) {
      clearTimeout(this.echoTimeout);
      this.echoTimeout = null;
    }

    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }

    this.ptyProcess = null;
  }
}
