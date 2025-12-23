/**
 * Claude Print Executor - Silent background execution
 *
 * Uses `claude --print` with stdin piping for non-interactive execution.
 * Ideal for background processing when real-time output isn't needed.
 */

import { spawn, ChildProcess } from 'child_process';
import { createWriteStream, WriteStream } from 'fs';

export interface PrintExecutorOptions {
  promptText: string;
  workingDirectory: string;
  logFile: string;
  instanceId: string;
  claudePath?: string;
  claudeArgs?: string[];
}

export class ClaudePrintExecutor {
  private child: ChildProcess | null = null;
  private logStream: WriteStream | null = null;

  /**
   * Start Claude in print mode (non-interactive, silent execution)
   * Uses stdin piping to handle long prompts that exceed command-line limits
   */
  async start(options: PrintExecutorOptions): Promise<number> {
    const { promptText, workingDirectory, logFile, instanceId, claudePath = 'claude', claudeArgs } = options;

    return new Promise((resolve, reject) => {
      // Create log file stream
      this.logStream = createWriteStream(logFile, { flags: 'a' });

      // Write session header to log
      const header = `=== Claude Print Mode Session ===\nInstance ID: ${instanceId}\nWorking Directory: ${workingDirectory}\nStarted: ${new Date().toISOString()}\n\n`;
      this.logStream.write(header);

      // Prepare environment - exclude API key to force desktop mode
      const { ANTHROPIC_API_KEY, ...cleanEnv } = process.env;

      const baseArgs = claudeArgs && claudeArgs.length > 0
        ? claudeArgs
        : ['--dangerously-skip-permissions'];
      const printArgs = baseArgs.includes('--print')
        ? baseArgs
        : ['--print', ...baseArgs];

      // Spawn Claude with --print flag, prompt will be piped via stdin
      this.child = spawn(claudePath, printArgs, {
        cwd: workingDirectory,
        env: {
          ...cleanEnv,
          CLAUDE_INSTANCE_ID: instanceId,
          AUTONOMOUS_PARENT_PID: process.pid.toString(),
        },
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Write prompt to stdin and close it
      if (this.child.stdin) {
        this.child.stdin.write(promptText);
        this.child.stdin.end();
      }

      // Pipe stdout/stderr to log file
      if (this.child.stdout) {
        this.child.stdout.pipe(this.logStream, { end: false });
      }

      if (this.child.stderr) {
        this.child.stderr.pipe(this.logStream, { end: false });
      }

      // Handle exit
      this.child.on('exit', (code, signal) => {
        const exitInfo = `\n\n=== Session Ended ===\nExit code: ${code}\nSignal: ${signal}\nEnded: ${new Date().toISOString()}\n`;
        if (this.logStream) {
          this.logStream.write(exitInfo);
          this.logStream.end();
          this.logStream = null;
        }

        if (signal) {
          reject(new Error(`Claude process killed by signal ${signal}`));
        } else {
          resolve(code ?? 0);
        }
      });

      // Handle errors
      this.child.on('error', (error) => {
        if (this.logStream) {
          this.logStream.write(`\n\nERROR: ${error.message}\n`);
          this.logStream.end();
          this.logStream = null;
        }
        reject(error);
      });

      // Unref so parent can exit without waiting
      this.child.unref();
    });
  }

  /**
   * Stop the process
   */
  stop(): void {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }

    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  /**
   * Get the process ID
   */
  getPid(): number | undefined {
    return this.child?.pid;
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    return this.child != null && this.child.exitCode === null;
  }
}
