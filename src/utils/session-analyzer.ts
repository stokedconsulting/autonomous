/**
 * Session analyzer utilities for detecting completion signals in session logs
 */

import * as fs from 'fs';

/**
 * Autonomous signal constants - must match prompt-builder.ts
 */
const AUTONOMOUS_SIGNALS = {
  PREFIX: 'AUTONOMOUS_SIGNAL:',
  COMPLETE: 'AUTONOMOUS_SIGNAL:COMPLETE',
  BLOCKED: 'AUTONOMOUS_SIGNAL:BLOCKED:',
  FAILED: 'AUTONOMOUS_SIGNAL:FAILED:',
  PR: 'AUTONOMOUS_SIGNAL:PR:',
} as const;

/**
 * Result of detecting autonomous signals in session output
 */
export interface AutonomousSignalResult {
  hasSignal: boolean;
  isComplete: boolean;
  isBlocked: boolean;
  isFailed: boolean;
  prNumber?: number;
  blockedReason?: string;
  failedReason?: string;
}

/**
 * Detect deterministic autonomous signals in session log
 * These are explicit signals output by Claude following our prompt instructions
 * This is the PRIMARY completion detection method - more reliable than pattern matching
 *
 * @param logPath Path to the session log file
 * @returns Parsed signal information
 */
export function detectAutonomousSignals(logPath: string): AutonomousSignalResult {
  const result: AutonomousSignalResult = {
    hasSignal: false,
    isComplete: false,
    isBlocked: false,
    isFailed: false,
  };

  try {
    if (!fs.existsSync(logPath)) {
      return result;
    }

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');

    // Scan lines for autonomous signals (check last 500 lines for efficiency)
    const recentLines = lines.slice(-500);

    for (const line of recentLines) {
      const trimmedLine = line.trim();

      // Check for COMPLETE signal
      if (trimmedLine === AUTONOMOUS_SIGNALS.COMPLETE ||
          trimmedLine.includes(AUTONOMOUS_SIGNALS.COMPLETE)) {
        result.hasSignal = true;
        result.isComplete = true;
      }

      // Check for PR signal - extract number
      if (trimmedLine.startsWith(AUTONOMOUS_SIGNALS.PR) ||
          trimmedLine.includes(AUTONOMOUS_SIGNALS.PR)) {
        result.hasSignal = true;
        const prMatch = trimmedLine.match(/AUTONOMOUS_SIGNAL:PR:(\d+)/);
        if (prMatch) {
          result.prNumber = parseInt(prMatch[1], 10);
        }
      }

      // Check for BLOCKED signal - extract reason
      if (trimmedLine.startsWith(AUTONOMOUS_SIGNALS.BLOCKED) ||
          trimmedLine.includes(AUTONOMOUS_SIGNALS.BLOCKED)) {
        result.hasSignal = true;
        result.isBlocked = true;
        const blockedMatch = trimmedLine.match(/AUTONOMOUS_SIGNAL:BLOCKED:(.+)/);
        if (blockedMatch) {
          result.blockedReason = blockedMatch[1].trim();
        }
      }

      // Check for FAILED signal - extract reason
      if (trimmedLine.startsWith(AUTONOMOUS_SIGNALS.FAILED) ||
          trimmedLine.includes(AUTONOMOUS_SIGNALS.FAILED)) {
        result.hasSignal = true;
        result.isFailed = true;
        const failedMatch = trimmedLine.match(/AUTONOMOUS_SIGNAL:FAILED:(.+)/);
        if (failedMatch) {
          result.failedReason = failedMatch[1].trim();
        }
      }
    }
  } catch (error) {
    console.error(`Error detecting autonomous signals: ${error}`);
  }

  return result;
}

/**
 * Completion indicators that suggest work is done
 * These patterns are matched against lowercase log content
 */
const COMPLETION_INDICATORS = [
  // PR creation patterns
  'pull request created',
  'pr created',
  'pr #\\d+ is (open|ready)',
  'pr:\\s*https://github\\.com',  // PR: https://github.com/...
  'github\\.com/[^/]+/[^/]+/pull/\\d+',  // Any GitHub PR URL

  // Completion status patterns
  'work.*complete',
  'task.*complete',
  'phase.*complete',
  'documentation.*complete',
  'implementation.*complete',
  'successfully implemented',
  'implementation summary',

  // Requirements/criteria patterns
  'all.*requirements.*met',
  'acceptance criteria.*met',
  'acceptance criteria met',  // Simpler pattern
  '\\|\\s*✅\\s*\\|',  // Table cells with checkmarks like "| ✅ |"
  '✅.*complete',
  '✅ completed',
  'status.*✅',

  // Test/check patterns
  'all.*tests.*pass',
  'tests passing',
  '\\d+.*tests.*passing',  // "96 tests passing"
  'pre-push checks passed',
  'all checks passed',
  'lint.*pass',
  'type-check.*pass',

  // Review patterns
  'ready for review',
  'awaiting.*review',
  'merged to',
  'successfully merged',

  // Files created/modified patterns (common in Claude summaries)
  'files created',
  'files modified',
  'files created/modified',
];

/**
 * Check if a session log contains completion indicators
 * @param logPath Path to the session log file
 * @param maxAge Maximum age of session in milliseconds to consider (default 10 minutes)
 * @returns Object with completion status and details
 */
export function detectSessionCompletion(
  logPath: string,
  maxAge: number = 10 * 60 * 1000
): {
  isComplete: boolean;
  hasRecentActivity: boolean;
  indicators: string[];
  lastActivity?: Date;
} {
  try {
    if (!fs.existsSync(logPath)) {
      return {
        isComplete: false,
        hasRecentActivity: false,
        indicators: [],
      };
    }

    // Check file modification time
    const stats = fs.statSync(logPath);
    const lastModified = stats.mtime;
    const age = Date.now() - lastModified.getTime();
    const hasRecentActivity = age < maxAge;

    // Read the last 1000 lines of the log
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');
    const recentLines = lines.slice(-1000).join('\n').toLowerCase();

    // Check for completion indicators
    const foundIndicators: string[] = [];
    for (const indicator of COMPLETION_INDICATORS) {
      const regex = new RegExp(indicator, 'i');
      if (regex.test(recentLines)) {
        foundIndicators.push(indicator);
      }
    }

    // Check for "Session Ended" message
    const hasSessionEnded = /=== session ended ===/i.test(recentLines);

    // Consider complete if EITHER:
    // A) Session has ended AND has completion indicators (primary path)
    // B) Has completion indicators AND recent activity (session just finished, hook-based detection)
    // The recent activity check ensures we're looking at fresh output, not stale logs
    const isComplete =
      (hasSessionEnded && foundIndicators.length > 0) ||
      (foundIndicators.length > 0 && hasRecentActivity);

    return {
      isComplete,
      hasRecentActivity,
      indicators: foundIndicators,
      lastActivity: lastModified,
    };
  } catch (error) {
    console.error(`Error analyzing session log: ${error}`);
    return {
      isComplete: false,
      hasRecentActivity: false,
      indicators: [],
    };
  }
}

/**
 * Extract PR number from session log if one was created
 * @param logPath Path to the session log file
 * @returns PR number if found, undefined otherwise
 */
export function extractPRNumber(logPath: string): number | undefined {
  try {
    if (!fs.existsSync(logPath)) {
      return undefined;
    }

    const content = fs.readFileSync(logPath, 'utf-8');

    // Look for PR patterns like "PR #123" or "pull request #123"
    const prPatterns = [
      /\bpr\s+#(\d+)/i,
      /pull request\s+#(\d+)/i,
      /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i,
    ];

    for (const pattern of prPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }

    return undefined;
  } catch (error) {
    console.error(`Error extracting PR number: ${error}`);
    return undefined;
  }
}

/**
 * Check if session has been idle (no new output) for too long
 * @param logPath Path to the session log file
 * @param idleThreshold Time in milliseconds to consider idle (default 30 minutes)
 * @returns true if session has been idle too long
 */
export function isSessionIdle(
  logPath: string,
  idleThreshold: number = 30 * 60 * 1000
): boolean {
  try {
    if (!fs.existsSync(logPath)) {
      return true;
    }

    const stats = fs.statSync(logPath);
    const lastModified = stats.mtime;
    const timeSinceLastUpdate = Date.now() - lastModified.getTime();

    return timeSinceLastUpdate > idleThreshold;
  } catch (error) {
    return true;
  }
}
