/**
 * Claude PTY Executor - Real-time streaming execution via pseudo-terminal
 *
 * Uses node-pty to spawn Claude in an interactive terminal environment,
 * enabling real-time output streaming while maintaining programmatic control.
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { createWriteStream, WriteStream } from 'fs';

export interface PTYExecutorOptions {
  promptText: string;
  workingDirectory: string;
  logFile: string;
  instanceId: string;
  onData?: (data: string) => void;
  claudePath?: string;
  cols?: number;
  rows?: number;
}

export class ClaudePTYExecutor extends EventEmitter {
  private ptyProcess: any;
  private logStream: WriteStream | null = null;
  private hasSentPrompt = false;
  private isActive = false;

  /**
   * Start Claude in PTY mode with real-time output streaming
   */
  async start(options: PTYExecutorOptions): Promise<number> {
    const {
      promptText,
      workingDirectory,
      logFile,
      instanceId,
      onData,
      claudePath = 'claude',
      cols = process.stdout.columns || 120,
      rows = process.stdout.rows || 40,
    } = options;

    this.isActive = true;

    // Create log file stream
    this.logStream = createWriteStream(logFile, { flags: 'a' });

    // Spawn Claude in PTY with terminal emulation
    // Prepare environment - exclude API key to force desktop mode
    const { ANTHROPIC_API_KEY, ...cleanEnv } = process.env;
    
    this.ptyProcess = pty.spawn(claudePath, ['--dangerously-skip-permissions'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workingDirectory,
      env: {
        ...cleanEnv,
        CLAUDE_INSTANCE_ID: instanceId,
        AUTONOMOUS_PARENT_PID: process.pid.toString(),
      },
    });

    // Handle real-time output
    this.ptyProcess.onData((data: string) => {
      // Write to log file
      if (this.logStream) {
        this.logStream.write(data);
      }

      // Stream to console if callback provided
      if (onData) {
        onData(data);
      } else if (this.isActive) {
        process.stdout.write(data);
      }

      // Detect when Claude is ready (shows working directory in banner)
      if (!this.hasSentPrompt && data.includes(workingDirectory)) {
        this.hasSentPrompt = true;

        // Wait for Ink UI to fully mount
        setTimeout(() => {
          if (this.isActive) {
            // Send the prompt text
            this.ptyProcess.write(promptText);

            // Send Enter key (both newline and carriage return for compatibility)
            setTimeout(() => {
              if (this.isActive) {
                this.ptyProcess.write('\x0D'); // Carriage return
              }
            }, 250);
          }
        }, 1000);
      }
    });

    // Handle exit
    return new Promise((resolve, reject) => {
      this.ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        this.cleanup();

        if (signal) {
          this.emit('exit', { exitCode: exitCode ?? 1, signal });
          reject(new Error(`Claude process killed by signal ${signal}`));
        } else {
          this.emit('exit', { exitCode: exitCode ?? 0 });
          resolve(exitCode ?? 0);
        }
      });
    });
  }

  /**
   * Stop the PTY process
   */
  stop(): void {
    this.isActive = false;

    if (this.ptyProcess) {
      this.ptyProcess.kill();
    }

    this.cleanup();
  }

  /**
   * Get the process ID
   */
  getPid(): number | undefined {
    return this.ptyProcess?.pid;
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    return this.isActive && this.ptyProcess != null;
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.isActive = false;

    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}