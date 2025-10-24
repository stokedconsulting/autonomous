/**
 * GitHub Token Utility
 * Automatically resolves GitHub token from multiple sources
 */

import { execSync } from 'child_process';

/**
 * Get GitHub token from various sources in priority order:
 * 1. GITHUB_TOKEN environment variable
 * 2. Config file token
 * 3. gh CLI authenticated token (gh auth token)
 */
export async function getGitHubToken(configToken?: string): Promise<string> {
  // Check environment variable first
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // Check config file
  if (configToken) {
    return configToken;
  }

  // Fall back to gh CLI authentication
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
    if (token) {
      return token;
    }
  } catch (error) {
    // gh CLI not authenticated or not installed
  }

  throw new Error(
    'GitHub token not found. Please authenticate with one of:\n' +
    '  1. Set GITHUB_TOKEN environment variable\n' +
    '  2. Add token to .autonomous-config.json under github.token\n' +
    '  3. Run: gh auth login'
  );
}

/**
 * Check if GitHub token is available (without throwing)
 */
export function hasGitHubToken(configToken?: string): boolean {
  if (process.env.GITHUB_TOKEN || configToken) {
    return true;
  }

  try {
    const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
    return !!token;
  } catch {
    return false;
  }
}
