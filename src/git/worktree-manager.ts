/**
 * Worktree Manager - Handles git worktree operations
 */

import { $ } from 'zx';
import { resolve } from 'path';
import { promises as fs } from 'fs';

export interface CreateWorktreeOptions {
  issueNumber: number;
  branchName: string;
  baseDir: string;
  projectName: string;
  baseBranch?: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
}

export class WorktreeManager {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /**
   * Create a new worktree for an issue
   */
  async createWorktree(options: CreateWorktreeOptions): Promise<string> {
    const { issueNumber, branchName, baseDir, projectName, baseBranch = 'main' } = options;

    // Generate worktree path
    const worktreeName = `${projectName}-issue-${issueNumber}`;
    const worktreePath = resolve(this.projectPath, baseDir, worktreeName);

    // Check if worktree already exists
    const exists = await this.worktreeExists(worktreePath);
    if (exists) {
      // Worktree exists - remove it and recreate
      // This handles cases where a previous run was interrupted
      console.log(`Worktree already exists at ${worktreePath}, removing and recreating...`);
      try {
        await this.removeWorktree(worktreePath, true); // force remove
      } catch (error) {
        throw new Error(`Failed to remove existing worktree at ${worktreePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Check if branch already exists
    const branchExists = await this.branchExists(branchName);
    if (branchExists) {
      // Checkout existing branch
      await $`cd ${this.projectPath} && git worktree add ${worktreePath} ${branchName}`;
    } else {
      // Create new branch from base
      await $`cd ${this.projectPath} && git worktree add -b ${branchName} ${worktreePath} ${baseBranch}`;
    }

    return worktreePath;
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {
    const exists = await this.worktreeExists(worktreePath);
    if (!exists) {
      throw new Error(`Worktree does not exist at ${worktreePath}`);
    }

    const forceFlag = force ? '--force' : '';
    await $`cd ${this.projectPath} && git worktree remove ${worktreePath} ${forceFlag}`;
  }

  /**
   * List all worktrees
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const result = await $`cd ${this.projectPath} && git worktree list --porcelain`;
    return this.parseWorktreeList(result.stdout);
  }

  /**
   * Get information about a specific worktree
   */
  async getWorktreeInfo(worktreePath: string): Promise<WorktreeInfo | null> {
    const worktrees = await this.listWorktrees();
    return worktrees.find((w) => w.path === worktreePath) || null;
  }

  /**
   * Check if a worktree exists
   */
  async worktreeExists(worktreePath: string): Promise<boolean> {
    try {
      await fs.access(worktreePath);
      const worktrees = await this.listWorktrees();
      return worktrees.some((w) => w.path === worktreePath);
    } catch {
      return false;
    }
  }

  /**
   * Prune stale worktree administrative files
   */
  async pruneWorktrees(): Promise<void> {
    await $`cd ${this.projectPath} && git worktree prune`;
  }

  /**
   * Check if a branch exists
   */
  async branchExists(branchName: string): Promise<boolean> {
    try {
      await $`cd ${this.projectPath} && git rev-parse --verify ${branchName}`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current branch in a worktree
   */
  async getCurrentBranch(worktreePath: string): Promise<string> {
    const result = await $`cd ${worktreePath} && git branch --show-current`;
    return result.stdout.trim();
  }

  /**
   * Check if a worktree has uncommitted changes
   */
  async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    const result = await $`cd ${worktreePath} && git status --porcelain`;
    return result.stdout.trim().length > 0;
  }

  /**
   * Get the status of a worktree
   */
  async getStatus(worktreePath: string): Promise<string> {
    const result = await $`cd ${worktreePath} && git status --short`;
    return result.stdout;
  }

  /**
   * Push changes from a worktree
   */
  async push(worktreePath: string, remote: string = 'origin', setUpstream: boolean = true): Promise<void> {
    const branch = await this.getCurrentBranch(worktreePath);
    const upstreamFlag = setUpstream ? '--set-upstream' : '';
    await $`cd ${worktreePath} && git push ${upstreamFlag} ${remote} ${branch}`;
  }

  /**
   * Commit changes in a worktree
   */
  async commit(worktreePath: string, message: string, addAll: boolean = true): Promise<void> {
    if (addAll) {
      await $`cd ${worktreePath} && git add -A`;
    }
    await $`cd ${worktreePath} && git commit -m ${message}`;
  }

  /**
   * Get commit count ahead/behind of remote
   */
  async getAheadBehind(worktreePath: string, remote: string = 'origin'): Promise<{ ahead: number; behind: number }> {
    const branch = await this.getCurrentBranch(worktreePath);

    try {
      const result = await $`cd ${worktreePath} && git rev-list --left-right --count ${remote}/${branch}...HEAD`;
      const [behind, ahead] = result.stdout.trim().split('\t').map(Number);
      return { ahead, behind };
    } catch {
      // Branch doesn't exist on remote
      return { ahead: 0, behind: 0 };
    }
  }

  /**
   * Check if changes are pushed to remote
   */
  async isPushed(worktreePath: string, remote: string = 'origin'): Promise<boolean> {
    const { ahead } = await this.getAheadBehind(worktreePath, remote);
    return ahead === 0;
  }

  /**
   * Parse git worktree list output
   */
  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const lines = output.trim().split('\n');

    let current: Partial<WorktreeInfo> = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current as WorktreeInfo);
        }
        current = {
          path: line.substring('worktree '.length),
          bare: false,
          detached: false,
          locked: false,
        };
      } else if (line.startsWith('HEAD ')) {
        current.commit = line.substring('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring('branch '.length).replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === 'detached') {
        current.detached = true;
      } else if (line.startsWith('locked')) {
        current.locked = true;
      }
    }

    if (current.path) {
      worktrees.push(current as WorktreeInfo);
    }

    return worktrees;
  }

  /**
   * Validate that the project is a git repository
   */
  async validateGitRepo(): Promise<boolean> {
    try {
      await $`cd ${this.projectPath} && git rev-parse --git-dir`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the default branch name
   */
  async getDefaultBranch(): Promise<string> {
    try {
      const result = await $`cd ${this.projectPath} && git symbolic-ref refs/remotes/origin/HEAD`;
      return result.stdout.trim().replace('refs/remotes/origin/', '');
    } catch {
      // Fallback to common branch names
      const branches = ['main', 'master', 'develop'];
      for (const branch of branches) {
        if (await this.branchExists(branch)) {
          return branch;
        }
      }
      throw new Error('Could not determine default branch');
    }
  }
}
