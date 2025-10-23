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
  try {
    // Get the remote URL for origin
    const result = await $`cd ${cwd} && git remote get-url origin`;
    const remoteUrl = result.stdout.trim();

    return parseGitHubUrl(remoteUrl);
  } catch (error) {
    return null;
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
  try {
    await $`cd ${cwd} && git rev-parse --git-dir`;
    return true;
  } catch (error) {
    return false;
  }
}
