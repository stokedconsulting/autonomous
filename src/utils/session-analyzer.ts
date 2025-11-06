/**
 * Session analyzer utilities for detecting completion signals in session logs
 */

import * as fs from 'fs';

/**
 * Completion indicators that suggest work is done
 */
const COMPLETION_INDICATORS = [
  'pull request created',
  'pr created',
  'pr #\\d+ is (open|ready)',
  'work.*complete',
  'task.*complete',
  'phase.*complete',
  'documentation.*complete',
  'implementation.*complete',
  'all.*requirements.*met',
  'acceptance criteria.*met',
  '✅.*complete',
  'ready for review',
  'awaiting.*review',
  'merged to',
  'successfully merged',
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

    // Consider complete if:
    // 1. Session has ended AND
    // 2. Has completion indicators AND
    // 3. No recent activity (session ended > maxAge ago is suspicious, might be crash)
    const isComplete =
      hasSessionEnded &&
      foundIndicators.length > 0 &&
      !hasRecentActivity;

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
