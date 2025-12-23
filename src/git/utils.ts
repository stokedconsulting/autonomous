/**
 * Git utility functions
 */

import { $ } from 'zx';

export interface GitHubRemoteInfo {
  owner: string;
  repo: string;
  url: string;
}

/**
 * Parse GitHub owner and repo from git remote URL
 */
export async function parseGitHubRemote(cwd: string = process.cwd()): Promise<GitHubRemoteInfo | null> {
  const originalVerbose = $.verbose;
  $.verbose = false; // Suppress command echoing
  try {
    // Get the remote URL for origin
    const result = await $`cd ${cwd} && git remote get-url origin`;
    const remoteUrl = result.stdout.trim();

    return parseGitHubUrl(remoteUrl);
  } catch (error) {
    return null;
  } finally {
    $.verbose = originalVerbose; // Restore original verbose setting
  }
}

/**
 * Parse GitHub owner and repo from a GitHub URL
 * Supports both HTTPS and SSH formats:
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 * - https://github.com/owner/repo
 * - git@github.com:owner/repo
 */
export function parseGitHubUrl(url: string): GitHubRemoteInfo | null {
  // Remove .git suffix if present
  const cleanUrl = url.replace(/\.git$/, '');

  // Try HTTPS format
  const httpsMatch = cleanUrl.match(/https?:\/\/github\.com\/([^\/]+)\/([^\/]+)/);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2],
      url,
    };
  }

  // Try SSH format
  const sshMatch = cleanUrl.match(/git@github\.com:([^\/]+)\/(.+)/);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
      url,
    };
  }

  return null;
}

/**
 * Get the current git branch name
 */
export async function getCurrentBranch(cwd: string = process.cwd()): Promise<string | null> {
  try {
    const result = await $`cd ${cwd} && git branch --show-current`;
    return result.stdout.trim();
  } catch (error) {
    return null;
  }
}

/**
 * Check if the current directory is a git repository
 */
export async function isGitRepository(cwd: string = process.cwd()): Promise<boolean> {
  const originalVerbose = $.verbose;
  $.verbose = false; // Suppress command echoing
  try {
    await $`cd ${cwd} && git rev-parse --git-dir`;
    return true;
  } catch (error) {
    return false;
  } finally {
    $.verbose = originalVerbose; // Restore original verbose setting
  }
}

/**
 * Get the git repository root directory
 * Handles both regular repositories and worktrees correctly
 */
export async function getGitRoot(cwd: string = process.cwd()): Promise<string | null> {
  const originalVerbose = $.verbose;
  $.verbose = false; // Suppress command echoing
  try {
    // Get the common git directory (handles worktrees)
    const commonDirResult = await $`cd ${cwd} && git rev-parse --git-common-dir`;
    const commonDir = commonDirResult.stdout.trim();

    // If it's an absolute path to .git, get its parent directory
    // Otherwise, resolve it relative to cwd and get parent
    if (commonDir.endsWith('/.git')) {
      return commonDir.replace(/\/\.git$/, '');
    } else if (commonDir === '.git') {
      // Regular repo, use show-toplevel
      const result = await $`cd ${cwd} && git rev-parse --show-toplevel`;
      return result.stdout.trim();
    } else {
      // Relative path to common dir (e.g., "../../.git")
      const { dirname } = await import('path');
      const { resolve } = await import('path');
      const absoluteCommonDir = resolve(cwd, commonDir);
      return dirname(absoluteCommonDir);
    }
  } catch (error) {
    return null;
  } finally {
    $.verbose = originalVerbose; // Restore original verbose setting
  }
}
