/**
 * Git utilities for repository detection
 */

import { execSync } from 'child_process';

export interface GitRepo {
  owner: string;
  repo: string;
}

/**
 * Extract owner and repo from Git remote URL
 * Supports both SSH and HTTPS formats:
 * - git@github.com:stokedconsulting/autonomous.git
 * - https://github.com/stokedconsulting/autonomous.git
 */
export function parseGitRemote(remoteUrl: string): GitRepo | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2].replace(/\.git$/, ''),
    };
  }

  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2].replace(/\.git$/, ''),
    };
  }

  return null;
}

/**
 * Get current directory's Git repository info
 * Returns null if not in a Git repository or remote not configured
 */
export function getCurrentRepo(cwd: string = process.cwd()): GitRepo | null {
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return parseGitRemote(remoteUrl);
  } catch (error) {
    // Not in a Git repo or remote not configured
    return null;
  }
}

/**
 * Get organization from current repo
 */
export function getCurrentOrg(cwd: string = process.cwd()): string | null {
  const repo = getCurrentRepo(cwd);
  return repo?.owner || null;
}
