import { spawn, ChildProcess } from 'child_process';
import { createWriteStream, WriteStream } from 'fs';

export interface CodexExecExecutorOptions {
  command: string;
  args: string[];
  promptText: string;
  workingDirectory: string;
  logFile: string;
  instanceId: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Executes Codex in non-interactive exec mode by piping the prompt over stdin.
 * This avoids the interactive TUI that hangs waiting for user keystrokes.
 */
export class CodexExecExecutor {
  private child: ChildProcess | null = null;
  private logStream: WriteStream | null = null;

  async start(options: CodexExecExecutorOptions): Promise<number> {
    const { command, args, promptText, workingDirectory, logFile, instanceId, env } = options;

    return new Promise((resolve, reject) => {
      this.logStream = createWriteStream(logFile, { flags: 'a' });
      const header = `=== Codex Exec Session ===\nInstance ID: ${instanceId}\nWorking Directory: ${workingDirectory}\nStarted: ${new Date().toISOString()}\n\n`;
      this.logStream.write(header);

      this.child = spawn(command, args, {
        cwd: workingDirectory,
        env: {
          ...process.env,
          ...env,
          AUTONOMOUS_INSTANCE_ID: instanceId,
          AUTONOMOUS_PARENT_PID: process.pid.toString(),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });

      // Pipe output to log
      this.child.stdout?.pipe(this.logStream, { end: false });
      this.child.stderr?.pipe(this.logStream, { end: false });

      // Send prompt via stdin then close
      if (this.child.stdin) {
        this.child.stdin.write(promptText);
        this.child.stdin.end();
      }

      this.child.on('exit', (code, signal) => {
        if (this.logStream) {
          const exitInfo = `\n\n=== Session Ended ===\nExit code: ${code}\nSignal: ${signal}\nEnded: ${new Date().toISOString()}\n`;
          this.logStream.write(exitInfo);
          this.logStream.end();
          this.logStream = null;
        }

        if (signal) {
          reject(new Error(`Codex process killed by signal ${signal}`));
        } else {
          resolve(code ?? 0);
        }
      });

      this.child.on('error', (error) => {
        if (this.logStream) {
          this.logStream.write(`\n\nERROR: ${error.message}\n`);
          this.logStream.end();
          this.logStream = null;
        }
        reject(error);
      });

      this.child.unref();
    });
  }

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

  getPid(): number | undefined {
    return this.child?.pid;
  }

  isRunning(): boolean {
    return this.child != null && this.child.exitCode === null;
  }
}
