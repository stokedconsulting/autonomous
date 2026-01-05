/**
 * Response Tracker - File-based response logging and monitoring for Claude sessions
 *
 * Instead of parsing logs for heuristic patterns, this provides deterministic
 * detection by using a post-prompt hook that writes responses to a JSON file.
 * Monitoring code can watch the file for changes to detect prompt completion.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * Single response entry in the history
 */
export interface ResponseEntry {
  timestamp: string;
  responseNumber: number;
  transcript?: string;
  /** Summary extracted from transcript (first 500 chars) */
  summary?: string;
  /** Whether this response contains completion signals */
  hasCompletionSignal?: boolean;
  /** Whether this response is blocked */
  isBlocked?: boolean;
  blockReason?: string;
  /** Whether this response failed */
  isFailed?: boolean;
  failReason?: string;
  /** PR number if one was created */
  prNumber?: number;
  /** Duration of response generation in ms */
  durationMs?: number;
}

/**
 * Session response history file structure
 */
export interface SessionHistory {
  sessionId: string;
  assignmentId: string;
  workingDirectory: string;
  startedAt: string;
  lastUpdated: string;
  responseCount: number;
  isComplete: boolean;
  completedAt?: string;
  responses: ResponseEntry[];
}

/**
 * Autonomous signals that can appear in responses
 */
const AUTONOMOUS_SIGNALS = {
  COMPLETE: 'AUTONOMOUS_SIGNAL:COMPLETE',
  BLOCKED: 'AUTONOMOUS_SIGNAL:BLOCKED:',
  FAILED: 'AUTONOMOUS_SIGNAL:FAILED:',
  PR: 'AUTONOMOUS_SIGNAL:PR:',
} as const;

/**
 * ResponseTracker manages JSON-based response logging for Claude sessions
 */
export class ResponseTracker {
  private responsesDir: string;

  constructor(autonomousDataDir: string) {
    this.responsesDir = path.join(autonomousDataDir, 'responses');
  }

  /**
   * Get the path to a session's response file
   */
  getResponseFilePath(sessionId: string): string {
    return path.join(this.responsesDir, `${sessionId}.json`);
  }

  /**
   * Ensure the responses directory exists
   */
  async ensureDirectory(): Promise<void> {
    await fs.promises.mkdir(this.responsesDir, { recursive: true });
  }

  /**
   * Initialize a new session history file
   */
  async initSession(
    sessionId: string,
    assignmentId: string,
    workingDirectory: string
  ): Promise<void> {
    await this.ensureDirectory();

    const history: SessionHistory = {
      sessionId,
      assignmentId,
      workingDirectory,
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      responseCount: 0,
      isComplete: false,
      responses: [],
    };

    const filePath = this.getResponseFilePath(sessionId);
    await fs.promises.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
  }

  /**
   * Append a response to the session history
   * This is called by the post-prompt hook
   */
  async appendResponse(
    sessionId: string,
    transcript?: string,
    durationMs?: number
  ): Promise<ResponseEntry> {
    const filePath = this.getResponseFilePath(sessionId);
    let history: SessionHistory;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      history = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid - create minimal structure
      history = {
        sessionId,
        assignmentId: 'unknown',
        workingDirectory: process.cwd(),
        startedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        responseCount: 0,
        isComplete: false,
        responses: [],
      };
    }

    // Parse transcript for signals
    const signalResult = this.parseSignals(transcript || '');

    const entry: ResponseEntry = {
      timestamp: new Date().toISOString(),
      responseNumber: history.responseCount + 1,
      transcript,
      summary: transcript ? transcript.slice(0, 500) : undefined,
      hasCompletionSignal: signalResult.isComplete,
      isBlocked: signalResult.isBlocked,
      blockReason: signalResult.blockReason,
      isFailed: signalResult.isFailed,
      failReason: signalResult.failReason,
      prNumber: signalResult.prNumber,
      durationMs,
    };

    history.responses.push(entry);
    history.responseCount++;
    history.lastUpdated = new Date().toISOString();

    if (signalResult.isComplete) {
      history.isComplete = true;
      history.completedAt = new Date().toISOString();
    }

    await fs.promises.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
    return entry;
  }

  /**
   * Get the current session history
   */
  async getHistory(sessionId: string): Promise<SessionHistory | null> {
    const filePath = this.getResponseFilePath(sessionId);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Get the latest response entry
   */
  async getLatestResponse(sessionId: string): Promise<ResponseEntry | null> {
    const history = await this.getHistory(sessionId);
    if (!history || history.responses.length === 0) {
      return null;
    }
    return history.responses[history.responses.length - 1];
  }

  /**
   * Check if session is complete based on last response
   */
  async isSessionComplete(sessionId: string): Promise<boolean> {
    const history = await this.getHistory(sessionId);
    return history?.isComplete ?? false;
  }

  /**
   * Get the file's last modified time for change detection
   */
  async getLastModified(sessionId: string): Promise<Date | null> {
    const filePath = this.getResponseFilePath(sessionId);

    try {
      const stats = await fs.promises.stat(filePath);
      return stats.mtime;
    } catch {
      return null;
    }
  }

  /**
   * Parse a transcript for autonomous signals
   */
  private parseSignals(transcript: string): {
    isComplete: boolean;
    isBlocked: boolean;
    blockReason?: string;
    isFailed: boolean;
    failReason?: string;
    prNumber?: number;
  } {
    const result = {
      isComplete: false,
      isBlocked: false,
      blockReason: undefined as string | undefined,
      isFailed: false,
      failReason: undefined as string | undefined,
      prNumber: undefined as number | undefined,
    };

    if (!transcript) return result;

    // Check for COMPLETE signal
    if (transcript.includes(AUTONOMOUS_SIGNALS.COMPLETE)) {
      result.isComplete = true;
    }

    // Check for BLOCKED signal
    const blockedMatch = transcript.match(/AUTONOMOUS_SIGNAL:BLOCKED:(.+?)(?:\n|$)/);
    if (blockedMatch) {
      result.isBlocked = true;
      result.blockReason = blockedMatch[1].trim();
    }

    // Check for FAILED signal
    const failedMatch = transcript.match(/AUTONOMOUS_SIGNAL:FAILED:(.+?)(?:\n|$)/);
    if (failedMatch) {
      result.isFailed = true;
      result.failReason = failedMatch[1].trim();
    }

    // Check for PR signal
    const prMatch = transcript.match(/AUTONOMOUS_SIGNAL:PR:(\d+)/);
    if (prMatch) {
      result.prNumber = parseInt(prMatch[1], 10);
    }

    return result;
  }

  /**
   * Mark session as complete manually
   */
  async markComplete(sessionId: string): Promise<void> {
    const history = await this.getHistory(sessionId);
    if (history) {
      history.isComplete = true;
      history.completedAt = new Date().toISOString();
      history.lastUpdated = new Date().toISOString();

      const filePath = this.getResponseFilePath(sessionId);
      await fs.promises.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
    }
  }

  /**
   * List all session files
   */
  async listSessions(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.responsesDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Delete a session's response file
   */
  async deleteSession(sessionId: string): Promise<void> {
    const filePath = this.getResponseFilePath(sessionId);
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // Ignore if doesn't exist
    }
  }
}

/**
 * ResponseWatcher - Watches response files for changes
 * Emits events when new responses are detected
 */
export class ResponseWatcher extends EventEmitter {
  private tracker: ResponseTracker;
  private sessionId: string;
  private watcher?: fs.FSWatcher;
  private lastResponseCount: number = 0;
  private pollInterval?: NodeJS.Timeout;
  private isWatching: boolean = false;

  constructor(tracker: ResponseTracker, sessionId: string) {
    super();
    this.tracker = tracker;
    this.sessionId = sessionId;
  }

  /**
   * Start watching for changes
   * Uses both fs.watch and polling for reliability
   */
  async start(): Promise<void> {
    if (this.isWatching) return;
    this.isWatching = true;

    const filePath = this.tracker.getResponseFilePath(this.sessionId);

    // Initialize response count
    const history = await this.tracker.getHistory(this.sessionId);
    this.lastResponseCount = history?.responseCount ?? 0;

    // Use fs.watch for immediate detection
    try {
      this.watcher = fs.watch(filePath, async (eventType) => {
        if (eventType === 'change') {
          await this.checkForNewResponse();
        }
      });

      this.watcher.on('error', () => {
        // Fall back to polling only
        this.watcher = undefined;
      });
    } catch {
      // File might not exist yet - will use polling
    }

    // Also poll as backup (fs.watch can be unreliable)
    this.pollInterval = setInterval(async () => {
      await this.checkForNewResponse();
    }, 1000);
  }

  /**
   * Stop watching
   */
  stop(): void {
    this.isWatching = false;

    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }

  /**
   * Check if a new response has been added
   */
  private async checkForNewResponse(): Promise<void> {
    if (!this.isWatching) return;

    try {
      const history = await this.tracker.getHistory(this.sessionId);
      if (!history) return;

      if (history.responseCount > this.lastResponseCount) {
        const newResponse = history.responses[history.responses.length - 1];
        this.lastResponseCount = history.responseCount;

        this.emit('response', newResponse);

        if (history.isComplete) {
          this.emit('complete', history);
        }

        if (newResponse.isBlocked) {
          this.emit('blocked', newResponse);
        }

        if (newResponse.isFailed) {
          this.emit('failed', newResponse);
        }
      }
    } catch {
      // File might not exist yet - ignore
    }
  }

  /**
   * Wait for the next response (promise-based)
   */
  async waitForResponse(timeoutMs: number = 300000): Promise<ResponseEntry> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('response', onResponse);
        reject(new Error(`Timeout waiting for response after ${timeoutMs}ms`));
      }, timeoutMs);

      const onResponse = (response: ResponseEntry) => {
        clearTimeout(timeout);
        this.removeListener('response', onResponse);
        resolve(response);
      };

      this.on('response', onResponse);
    });
  }

  /**
   * Wait for session completion
   */
  async waitForCompletion(timeoutMs: number = 3600000): Promise<SessionHistory> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('complete', onComplete);
        reject(new Error(`Timeout waiting for completion after ${timeoutMs}ms`));
      }, timeoutMs);

      const onComplete = (history: SessionHistory) => {
        clearTimeout(timeout);
        this.removeListener('complete', onComplete);
        resolve(history);
      };

      this.on('complete', onComplete);
    });
  }
}

/**
 * Generate the bash script for the post-prompt hook
 * This hook captures Claude's response and writes it to the session JSON file
 */
export function generatePostPromptHook(
  autonomousDataDir: string,
  sessionId: string,
  assignmentId: string
): string {
  const responsesDir = path.join(autonomousDataDir, 'responses');

  return `#!/bin/bash
# Post-prompt hook - Captures Claude's response and writes to session JSON
# This enables deterministic prompt completion detection via file watching

SESSION_ID="${sessionId}"
ASSIGNMENT_ID="${assignmentId}"
RESPONSES_DIR="${responsesDir}"
RESPONSE_FILE="\${RESPONSES_DIR}/\${SESSION_ID}.json"
TEMP_FILE="\${RESPONSES_DIR}/.\${SESSION_ID}.tmp"
START_TIME=\${HOOK_START_TIME:-$(date +%s%3N)}

# Ensure directory exists
mkdir -p "\${RESPONSES_DIR}"

# Read the hook input from stdin (contains transcript)
HOOK_INPUT=$(cat)

# Extract transcript from hook input (if available)
# The hook input is JSON with session_id, transcript, etc.
TRANSCRIPT=""
if command -v jq &> /dev/null; then
  TRANSCRIPT=$(echo "\$HOOK_INPUT" | jq -r '.transcript // empty' 2>/dev/null)
fi

# Calculate duration if we have start time
DURATION_MS=0
if [[ -n "\$START_TIME" ]]; then
  END_TIME=$(date +%s%3N)
  DURATION_MS=$((END_TIME - START_TIME))
fi

# Get current response count from file
RESPONSE_COUNT=0
IS_COMPLETE="false"
if [[ -f "\$RESPONSE_FILE" ]]; then
  if command -v jq &> /dev/null; then
    RESPONSE_COUNT=$(jq -r '.responseCount // 0' "\$RESPONSE_FILE" 2>/dev/null)
  fi
fi
RESPONSE_NUMBER=$((RESPONSE_COUNT + 1))

# Check for autonomous signals in transcript
HAS_COMPLETE="false"
IS_BLOCKED="false"
IS_FAILED="false"
BLOCK_REASON=""
FAIL_REASON=""
PR_NUMBER=""

if [[ "\$TRANSCRIPT" == *"AUTONOMOUS_SIGNAL:COMPLETE"* ]]; then
  HAS_COMPLETE="true"
  IS_COMPLETE="true"
fi

if [[ "\$TRANSCRIPT" == *"AUTONOMOUS_SIGNAL:BLOCKED:"* ]]; then
  IS_BLOCKED="true"
  BLOCK_REASON=$(echo "\$TRANSCRIPT" | grep -o 'AUTONOMOUS_SIGNAL:BLOCKED:[^[:space:]]*' | head -1 | cut -d: -f3-)
fi

if [[ "\$TRANSCRIPT" == *"AUTONOMOUS_SIGNAL:FAILED:"* ]]; then
  IS_FAILED="true"
  FAIL_REASON=$(echo "\$TRANSCRIPT" | grep -o 'AUTONOMOUS_SIGNAL:FAILED:[^[:space:]]*' | head -1 | cut -d: -f3-)
fi

if [[ "\$TRANSCRIPT" == *"AUTONOMOUS_SIGNAL:PR:"* ]]; then
  PR_NUMBER=$(echo "\$TRANSCRIPT" | grep -o 'AUTONOMOUS_SIGNAL:PR:[0-9]*' | head -1 | cut -d: -f3)
fi

# Create summary (first 500 chars of transcript)
SUMMARY=""
if [[ -n "\$TRANSCRIPT" ]]; then
  SUMMARY=\$(echo "\$TRANSCRIPT" | head -c 500 | tr '\\n' ' ' | sed 's/"/\\\\"/g')
fi

# Escape transcript for JSON
ESCAPED_TRANSCRIPT=""
if [[ -n "\$TRANSCRIPT" ]]; then
  # Use jq for proper JSON escaping if available
  if command -v jq &> /dev/null; then
    ESCAPED_TRANSCRIPT=$(echo "\$TRANSCRIPT" | jq -Rs . | sed 's/^"//;s/"$//')
  else
    # Fallback: basic escaping
    ESCAPED_TRANSCRIPT=\$(echo "\$TRANSCRIPT" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g; s/\\n/\\\\n/g')
  fi
fi

# Build the new response entry
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# If file exists, update it. Otherwise create new.
if [[ -f "\$RESPONSE_FILE" ]]; then
  # Use jq if available for proper JSON manipulation
  if command -v jq &> /dev/null; then
    jq --arg ts "\$TIMESTAMP" \\
       --argjson num "\$RESPONSE_NUMBER" \\
       --arg transcript "\$TRANSCRIPT" \\
       --arg summary "\$SUMMARY" \\
       --argjson complete "\$HAS_COMPLETE" \\
       --argjson blocked "\$IS_BLOCKED" \\
       --arg blockReason "\$BLOCK_REASON" \\
       --argjson failed "\$IS_FAILED" \\
       --arg failReason "\$FAIL_REASON" \\
       --arg prNum "\$PR_NUMBER" \\
       --argjson duration "\$DURATION_MS" \\
       --argjson isComplete "\$IS_COMPLETE" \\
       '.lastUpdated = \$ts |
        .responseCount = \$num |
        .isComplete = \$isComplete |
        (if \$isComplete then .completedAt = \$ts else . end) |
        .responses += [{
          timestamp: \$ts,
          responseNumber: \$num,
          transcript: \$transcript,
          summary: \$summary,
          hasCompletionSignal: \$complete,
          isBlocked: \$blocked,
          blockReason: (if \$blockReason != "" then \$blockReason else null end),
          isFailed: \$failed,
          failReason: (if \$failReason != "" then \$failReason else null end),
          prNumber: (if \$prNum != "" then (\$prNum | tonumber) else null end),
          durationMs: \$duration
        }]' "\$RESPONSE_FILE" > "\$TEMP_FILE" && mv "\$TEMP_FILE" "\$RESPONSE_FILE"
  else
    # Fallback without jq - append manually (less safe)
    echo "Warning: jq not available, using fallback append" >&2
  fi
else
  # Create new file
  if command -v jq &> /dev/null; then
    cat > "\$RESPONSE_FILE" << EOJSON
{
  "sessionId": "\$SESSION_ID",
  "assignmentId": "\$ASSIGNMENT_ID",
  "workingDirectory": "$(pwd)",
  "startedAt": "\$TIMESTAMP",
  "lastUpdated": "\$TIMESTAMP",
  "responseCount": 1,
  "isComplete": \$IS_COMPLETE,
  "responses": [{
    "timestamp": "\$TIMESTAMP",
    "responseNumber": 1,
    "transcript": $(echo "\$TRANSCRIPT" | jq -Rs .),
    "summary": "\$SUMMARY",
    "hasCompletionSignal": \$HAS_COMPLETE,
    "isBlocked": \$IS_BLOCKED,
    "blockReason": $(if [[ -n "\$BLOCK_REASON" ]]; then echo "\\"\\$BLOCK_REASON\\""; else echo "null"; fi),
    "isFailed": \$IS_FAILED,
    "failReason": $(if [[ -n "\$FAIL_REASON" ]]; then echo "\\"\\$FAIL_REASON\\""; else echo "null"; fi),
    "prNumber": $(if [[ -n "\$PR_NUMBER" ]]; then echo "\$PR_NUMBER"; else echo "null"; fi),
    "durationMs": \$DURATION_MS
  }]
}
EOJSON
  fi
fi

# Output success
echo "Response \$RESPONSE_NUMBER recorded to \$RESPONSE_FILE"

exit 0
`;
}
