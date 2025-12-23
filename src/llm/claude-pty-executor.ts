/**
 * Claude PTY Executor - Real-time streaming execution via pseudo-terminal
 *
 * Uses node-pty to spawn Claude in an interactive terminal environment,
 * enabling real-time output streaming while maintaining programmatic control.
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { createWriteStream, WriteStream } from 'fs';
import { homedir } from 'os';

export interface PTYExecutorOptions {
  promptText: string;
  workingDirectory: string;
  logFile: string;
  instanceId: string;
  onData?: (data: string) => void;
  claudePath?: string;
  claudeArgs?: string[];
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
      claudeArgs,
      cols = process.stdout.columns || 120,
      rows = process.stdout.rows || 40,
    } = options;

    this.isActive = true;

    // Create log file stream
    this.logStream = createWriteStream(logFile, { flags: 'a' });

    // Spawn Claude in PTY with terminal emulation
    // Prepare environment - exclude API key to force desktop mode
    // Also remove CI flag which could disable interactive terminal features
    const { ANTHROPIC_API_KEY, CI, ...cleanEnv } = process.env;
    
    const args = claudeArgs && claudeArgs.length > 0
      ? claudeArgs
      : ['--dangerously-skip-permissions'];

    this.ptyProcess = pty.spawn(claudePath, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workingDirectory,
      env: {
        ...cleanEnv,
        CLAUDE_INSTANCE_ID: instanceId,
        AUTONOMOUS_PARENT_PID: process.pid.toString(),
        // Force terminal features for nested PTY environments
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
      },
    });

    // Track output to detect full UI readiness
    let outputBuffer = '';

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

      // Accumulate output for readiness detection
      outputBuffer += data;
      // Keep buffer from growing too large
      if (outputBuffer.length > 10000) {
        outputBuffer = outputBuffer.slice(-5000);
      }

      // Detect when Claude UI is fully ready
      // Primary indicators: input prompt ">" or "bypass permissions" message
      // Secondary: working directory in banner
      const hasInputPrompt = outputBuffer.includes('> ') || outputBuffer.includes('>');
      const hasBypassMessage = outputBuffer.includes('bypass permissions');
      const tildeWorkingDir = workingDirectory.replace(homedir(), '~');
      const hasWorkingDir = outputBuffer.includes(workingDirectory) || outputBuffer.includes(tildeWorkingDir);

      // Need both: working directory shown AND input prompt ready
      const isFullyReady = hasWorkingDir && (hasInputPrompt || hasBypassMessage);

      if (!this.hasSentPrompt && isFullyReady) {
        this.hasSentPrompt = true;

        // Wait for Ink UI to fully mount and stabilize
        // Increased from 1000ms to 1500ms for reliability
        setTimeout(() => {
          if (this.isActive && this.ptyProcess) {
            // Send the prompt text
            this.ptyProcess.write(promptText);

            // Send Enter key after a delay for paste to complete
            // Increased from 250ms to 500ms for multi-line prompts
            setTimeout(() => {
              if (this.isActive && this.ptyProcess) {
                // Send carriage return to execute the command
                this.ptyProcess.write('\r');
              }
            }, 500);
          }
        }, 1500);
      }
    });

    // Handle exit
    return new Promise((resolve, reject) => {
      this.ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        // Write session ended marker BEFORE cleanup closes the log stream
        // This ensures detectSessionCompletion() can find the marker
        if (this.logStream) {
          const exitInfo = `\n\n=== Session Ended ===\nExit code: ${exitCode}\nSignal: ${signal}\nEnded: ${new Date().toISOString()}\n`;
          this.logStream.write(exitInfo);
        }

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
