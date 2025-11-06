# Claude CLI Execution Refactor Design

## Problem Statement

The current implementation uses `cat prompt.txt | claude chat` which:
- ❌ Buffers all output until completion (no real-time streaming)
- ❌ Cannot show Claude's thinking process as it works
- ❌ Provides no feedback during long-running operations
- ❌ Uses file piping which doesn't interact properly with Claude's interactive UI

## Solution: Pseudo-Terminal (PTY) Execution

Use `node-pty` to spawn Claude in an interactive terminal that captures real-time output while maintaining programmatic control.

### Key Discovery from `dest.js`

```javascript
// Uses node-pty to spawn Claude with real terminal emulation
const ptyProcess = pty.spawn("claude", ["--dangerously-skip-permissions"], {
  name: "xterm-256color",
  cols: 120,
  rows: 40,
  cwd: workingDirectory,
  env: process.env,
});

// Real-time output streaming
ptyProcess.onData((data) => {
  process.stdout.write(data);  // Shows output as Claude generates it
});
```

## Architecture Design

### Execution Modes

**1. Verbose Mode** (Real-time streaming)
- Use PTY-based execution
- Stream output directly to console
- Show Claude's full interactive experience
- Exit via session-end hook

**2. Non-Verbose Mode** (Silent background)
- Use `claude -p "[prompt]"` (print mode)
- No interactive output
- Capture results to log file
- Faster execution

### Component Structure

```
src/llm/
├── claude-adapter.ts           # Main adapter (modified)
├── claude-pty-executor.ts      # NEW: PTY-based execution
├── claude-print-executor.ts    # NEW: Non-verbose execution
└── claude-session-hook.sh      # NEW: Auto-exit hook
```

## Implementation Design

### 1. PTY Executor (Verbose Mode)

```typescript
// src/llm/claude-pty-executor.ts
import pty from 'node-pty';
import { EventEmitter } from 'events';

export interface PTYExecutorOptions {
  promptText: string;
  workingDirectory: string;
  logFile: string;
  instanceId: string;
  onData?: (data: string) => void;
}

export class ClaudePTYExecutor extends EventEmitter {
  private ptyProcess: any;
  private logStream: WriteStream;
  private hasSentPrompt = false;

  async start(options: PTYExecutorOptions): Promise<number> {
    const { promptText, workingDirectory, logFile, instanceId, onData } = options;

    // Create log file stream
    this.logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Spawn Claude in PTY
    this.ptyProcess = pty.spawn('claude', ['--dangerously-skip-permissions'], {
      name: 'xterm-256color',
      cols: process.stdout.columns || 120,
      rows: process.stdout.rows || 40,
      cwd: workingDirectory,
      env: {
        ...process.env,
        CLAUDE_INSTANCE_ID: instanceId,
        AUTONOMOUS_PARENT_PID: process.pid.toString(),
      },
    });

    // Handle real-time output
    this.ptyProcess.onData((data: string) => {
      // Write to log file
      this.logStream.write(data);

      // Stream to console if callback provided
      if (onData) {
        onData(data);
      } else {
        process.stdout.write(data);
      }

      // Detect when Claude is ready and send prompt
      if (!this.hasSentPrompt && data.includes(workingDirectory)) {
        this.hasSentPrompt = true;

        setTimeout(() => {
          this.ptyProcess.write(promptText);
          setTimeout(() => {
            this.ptyProcess.write('\x0D'); // Send Enter
          }, 250);
        }, 1000);
      }
    });

    // Handle exit
    return new Promise((resolve) => {
      this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        this.logStream.end();
        this.emit('exit', exitCode);
        resolve(exitCode ?? 0);
      });
    });
  }

  stop(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
    }
  }

  getPid(): number | undefined {
    return this.ptyProcess?.pid;
  }
}
```

### 2. Print Executor (Non-Verbose Mode)

```typescript
// src/llm/claude-print-executor.ts
import { spawn } from 'child_process';

export interface PrintExecutorOptions {
  promptText: string;
  workingDirectory: string;
  logFile: string;
  instanceId: string;
}

export class ClaudePrintExecutor {
  async start(options: PrintExecutorOptions): Promise<number> {
    const { promptText, workingDirectory, logFile, instanceId } = options;

    return new Promise((resolve, reject) => {
      // Use claude -p for non-interactive execution
      const child = spawn(
        'claude',
        ['-p', promptText, '--dangerously-skip-permissions'],
        {
          cwd: workingDirectory,
          env: {
            ...process.env,
            CLAUDE_INSTANCE_ID: instanceId,
            AUTONOMOUS_PARENT_PID: process.pid.toString(),
          },
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      const logStream = fs.createWriteStream(logFile, { flags: 'a' });

      // Pipe output to log file only
      child.stdout?.pipe(logStream);
      child.stderr?.pipe(logStream);

      child.on('exit', (code) => {
        logStream.end();
        resolve(code ?? 0);
      });

      child.on('error', (error) => {
        logStream.end();
        reject(error);
      });

      child.unref();
    });
  }
}
```

### 3. Session End Hook

```bash
#!/usr/bin/env bash
# src/llm/claude-session-hook.sh
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
```

### 4. Modified Claude Adapter

```typescript
// src/llm/claude-adapter.ts (key changes)

import { ClaudePTYExecutor } from './claude-pty-executor.js';
import { ClaudePrintExecutor } from './claude-print-executor.js';

export class ClaudeAdapter {
  private verbose: boolean;

  async start(options: StartLLMOptions): Promise<string> {
    const { assignment, prompt, workingDirectory } = options;
    const instanceId = assignment.llmInstanceId;

    // Install hooks if enabled
    if (this.config.hooksEnabled) {
      await this.installHooks(workingDirectory, assignment.id);
      await this.installSessionEndHook(workingDirectory);
    }

    // Prepare paths
    const logFile = join(this.getSubdirectory('logs'), `output-${instanceId}.log`);

    // Choose executor based on verbose mode
    if (this.verbose) {
      // PTY mode - real-time streaming
      const executor = new ClaudePTYExecutor();

      executor.on('exit', (exitCode) => {
        console.log(`\n✨ Claude session completed (exit code: ${exitCode})`);
      });

      const pid = await executor.start({
        promptText: prompt,
        workingDirectory,
        logFile,
        instanceId,
        onData: (data) => {
          process.stdout.write(data); // Real-time output
        },
      });

      const instance: ClaudeInstance = {
        instanceId,
        processId: pid,
        startedAt: new Date().toISOString(),
        assignmentId: assignment.id,
        worktreePath: workingDirectory,
        executor,
      };

      this.instances.set(instanceId, instance);
    } else {
      // Print mode - silent background
      const executor = new ClaudePrintExecutor();

      const pid = await executor.start({
        promptText: prompt,
        workingDirectory,
        logFile,
        instanceId,
      });

      const instance: ClaudeInstance = {
        instanceId,
        processId: pid,
        startedAt: new Date().toISOString(),
        assignmentId: assignment.id,
        worktreePath: workingDirectory,
      };

      this.instances.set(instanceId, instance);
    }

    return instanceId;
  }

  private async installSessionEndHook(workingDir: string): Promise<void> {
    const hookScript = `
#!/usr/bin/env bash
# Auto-exit for autonomous PTY sessions

if [[ -n "$AUTONOMOUS_PARENT_PID" ]]; then
  sleep 4
  echo ""
  echo "🤖 Autonomous session complete - exiting..."
  exit 0
fi
`;

    const hookPath = join(workingDir, '.claude', 'hooks', 'session-end.sh');
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, hookScript, 'utf-8');
    await fs.chmod(hookPath, 0o755);
  }
}
```

## Hook Integration

### Session End Hook Location
```
<worktree>/.claude/hooks/session-end.sh
```

### Hook Behavior
1. Checks for `AUTONOMOUS_PARENT_PID` environment variable
2. If present, waits 4 seconds for output to flush
3. Prints completion message
4. Exits cleanly with code 0

### Environment Variables
- `AUTONOMOUS_PARENT_PID`: Set to orchestrator process PID
- `CLAUDE_INSTANCE_ID`: Set to assignment instance ID

## Migration Strategy

### Phase 1: Add PTY Support
1. Install `node-pty` dependency
2. Create `claude-pty-executor.ts`
3. Add session-end hook installation

### Phase 2: Add Print Mode
1. Create `claude-print-executor.ts`
2. Implement non-verbose execution path

### Phase 3: Integrate with Adapter
1. Modify `claude-adapter.ts` to use executors
2. Add verbose flag propagation
3. Update orchestrator to pass verbose flag

### Phase 4: Remove Legacy Code
1. Remove old pipe-based execution
2. Remove tail monitoring (no longer needed in verbose mode)
3. Clean up unused log monitoring code

## Dependencies

### New Dependencies
```json
{
  "dependencies": {
    "node-pty": "^1.0.0"
  },
  "devDependencies": {
    "@types/node-pty": "^0.7.0"
  }
}
```

### Platform Considerations
- `node-pty` requires native compilation
- Works on macOS, Linux, Windows (WSL)
- May require build tools on first install

## Benefits

### Verbose Mode
✅ Real-time output streaming (see Claude think)
✅ Full interactive experience captured
✅ Natural exit via session-end hook
✅ Better user feedback and transparency

### Non-Verbose Mode
✅ Fast execution without UI overhead
✅ Silent background processing
✅ Lower resource usage
✅ Ideal for batch operations

### Both Modes
✅ Complete log files for debugging
✅ Proper exit code handling
✅ Environment variable propagation
✅ Consistent process management

## Testing Plan

### 1. PTY Executor Tests
```bash
# Test real-time output
node dist/llm/claude-pty-executor.js test-prompt.txt

# Verify log file creation
cat ~/.autonomous/logs/output-test.log

# Test hook integration
echo $AUTONOMOUS_PARENT_PID
```

### 2. Print Executor Tests
```bash
# Test silent execution
node dist/llm/claude-print-executor.js test-prompt.txt

# Verify exit codes
echo $?

# Test detached process
ps aux | grep claude
```

### 3. Integration Tests
```bash
# Test verbose mode
auto start --verbose

# Test non-verbose mode
auto start

# Test epic mode verbose
auto start --epic "Test Epic" --verbose

# Test process resurrection
kill -9 <claude-pid>
# Wait for resurrection check
```

## Rollout Plan

### Week 1: Development
- Implement PTY executor
- Implement print executor
- Add session-end hook support

### Week 2: Testing
- Test on macOS (primary platform)
- Test verbose and non-verbose modes
- Test epic orchestration integration

### Week 3: Deployment
- Release to production
- Monitor for issues
- Gather user feedback

## Success Metrics

- ✅ Real-time output visible in verbose mode
- ✅ Clean process exits without hanging
- ✅ Log files complete and accurate
- ✅ No performance degradation
- ✅ Both modes work reliably

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `node-pty` compilation failures | High | Pre-build binaries, fallback to print mode |
| Hook not executing | Medium | Detection and warning, manual exit fallback |
| PTY output formatting issues | Low | Stream raw data, let Claude handle formatting |
| Process leaks | Medium | Aggressive cleanup on exit, resurrection detection |

## Future Enhancements

1. **Interactive Input**: Allow user to send messages to running Claude instance
2. **Output Filtering**: Real-time filtering of debug/verbose output
3. **Multi-Instance Monitoring**: Dashboard view of all active instances
4. **Performance Metrics**: Track token usage, response times, success rates

---

## Conclusion

This refactor provides:
- ✅ Real-time output streaming in verbose mode
- ✅ Efficient silent execution in non-verbose mode
- ✅ Clean process management with automatic exits
- ✅ Better user experience and transparency
- ✅ Maintains all existing functionality

The PTY-based approach unlocks Claude's full interactive capabilities while maintaining programmatic control, finally solving the real-time output streaming challenge.
