/**
 * Debug logger that writes to a file for Ink debugging
 */
import { appendFileSync } from 'fs';
import { join } from 'path';

const LOG_FILE = join(process.cwd(), 'debug.log');

export function debugLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;

  try {
    appendFileSync(LOG_FILE, logLine);
  } catch (err) {
    // Silent fail - don't break the app if logging fails
  }
}

// Clear log file on startup
export function clearDebugLog(): void {
  try {
    const fs = require('fs');
    fs.writeFileSync(LOG_FILE, '');
  } catch (err) {
    // Silent fail
  }
}
