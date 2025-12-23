/**
 * MergeStageBranchManager - Manages the merge_stage temporary integration branch
 *
 * Responsibilities:
 * - Create/reset merge_stage branch from main
 * - Merge feature branches into merge_stage
 * - Detect and resolve merge conflicts
 * - Force push to stage branch
 */

import { $ } from 'zx';
import chalk from 'chalk';

export interface MergeResult {
  success: boolean;
  hasConflicts: boolean;
  conflictFiles?: string[];
  commitSha?: string;
  error?: string;
}

export interface MergeStageBranchManagerOptions {
  mainBranch?: string;
  stageBranch?: string;
  mergeStageBranch?: string;
}

export class MergeStageBranchManager {
  private mainBranch: string;
  private stageBranch: string;
  private mergeStageBranch: string;
  private projectPath: string;
  private mergeStageWorktreePath: string;

  constructor(projectPath: string, options: MergeStageBranchManagerOptions = {}) {
    this.projectPath = projectPath;
    this.mainBranch = options.mainBranch || 'main';
    this.stageBranch = options.stageBranch || 'stage';
    this.mergeStageBranch = options.mergeStageBranch || 'merge_stage';
    this.mergeStageWorktreePath = `${projectPath}/.worktrees/${this.mergeStageBranch}`;
  }

  /**
   * Create or reset merge_stage branch from main
   * Uses worktree instead of checkout to avoid switching branches in main repo
   */
  async createOrResetMergeStage(): Promise<void> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Fetch latest from remote
      await $`git fetch origin`;

      // Remove existing merge_stage worktree if it exists
      try {
        await $`git worktree remove ${this.mergeStageWorktreePath} --force`;
      } catch {
        // Worktree might not exist, that's fine
      }

      // Delete merge_stage branch if it exists (safe now that worktree is removed)
      try {
        await $`git branch -D ${this.mergeStageBranch}`;
      } catch {
        // Branch might not exist, that's fine
      }

      // Update main branch (in main repo, no checkout needed)
      await $`git fetch origin ${this.mainBranch}:${this.mainBranch}`;

      // Create fresh merge_stage branch from main
      await $`git branch ${this.mergeStageBranch} ${this.mainBranch}`;

      // Create worktree for merge_stage
      await $`git worktree add ${this.mergeStageWorktreePath} ${this.mergeStageBranch}`;

      console.log(chalk.green(`✓ Created fresh ${this.mergeStageBranch} worktree from ${this.mainBranch}`));
    } catch (error) {
      throw new Error(`Failed to create/reset merge_stage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Merge a feature branch into merge_stage
   * Works in merge_stage worktree context
   */
  async mergeFeatureBranch(branchName: string, issueNumber: number): Promise<MergeResult> {
    // Work in merge_stage worktree, not main repo
    $.cwd = this.mergeStageWorktreePath;
    $.verbose = false;

    try {
      // Fetch the feature branch from main repo
      try {
        await $`git fetch origin ${branchName}`;
      } catch {
        // Branch might only exist locally in main repo
        // Try to fetch from local refs
        const mainRepoGitDir = `${this.projectPath}/.git`;
        await $`git --git-dir=${mainRepoGitDir} fetch . ${branchName}:${branchName}`;
      }

      // Attempt merge with no-ff to preserve history
      try {
        const mergeMessage = `Merge ${branchName} (issue #${issueNumber}) into ${this.mergeStageBranch}`;
        await $`git merge --no-ff -m ${mergeMessage} ${branchName}`;

        // Get the commit SHA
        const commitSha = await $`git rev-parse HEAD`;

        return {
          success: true,
          hasConflicts: false,
          commitSha: commitSha.stdout.trim(),
        };
      } catch (error) {
        // Check if it's a merge conflict
        const status = await $`git status --porcelain`;
        const conflictLines = status.stdout.split('\n').filter(line => line.startsWith('UU '));

        if (conflictLines.length > 0) {
          // Extract conflict file paths
          const conflictFiles = conflictLines.map(line => line.substring(3).trim());

          return {
            success: false,
            hasConflicts: true,
            conflictFiles,
          };
        }

        // Some other merge error
        return {
          success: false,
          hasConflicts: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } catch (error) {
      return {
        success: false,
        hasConflicts: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if there are unresolved conflicts in merge_stage worktree
   */
  async hasUnresolvedConflicts(): Promise<boolean> {
    $.cwd = this.mergeStageWorktreePath;
    $.verbose = false;

    try {
      const status = await $`git status --porcelain`;
      const hasConflicts = status.stdout.includes('UU ');
      return hasConflicts;
    } catch {
      return false;
    }
  }

  /**
   * Get list of files with unresolved conflicts in merge_stage worktree
   */
  async getConflictFiles(): Promise<string[]> {
    $.cwd = this.mergeStageWorktreePath;
    $.verbose = false;

    try {
      const status = await $`git status --porcelain`;
      const conflictLines = status.stdout.split('\n').filter(line => line.startsWith('UU '));
      return conflictLines.map(line => line.substring(3).trim());
    } catch {
      return [];
    }
  }

  /**
   * Abort current merge in merge_stage worktree
   */
  async abortMerge(): Promise<void> {
    $.cwd = this.mergeStageWorktreePath;
    $.verbose = false;

    try {
      await $`git merge --abort`;
      console.log(chalk.yellow('⚠️  Merge aborted'));
    } catch {
      // No merge in progress
    }
  }

  /**
   * Commit resolved conflicts in merge_stage worktree
   */
  async commitResolvedConflicts(message: string): Promise<void> {
    $.cwd = this.mergeStageWorktreePath;
    $.verbose = false;

    try {
      // Add all resolved files
      await $`git add .`;

      // Commit with provided message
      await $`git commit -m ${message}`;

      console.log(chalk.green('✓ Committed resolved conflicts'));
    } catch (error) {
      throw new Error(`Failed to commit resolved conflicts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Force push merge_stage to stage branch
   * Works from merge_stage worktree
   */
  async forcePushToStage(): Promise<string> {
    $.cwd = this.mergeStageWorktreePath;
    $.verbose = false;

    try {
      // Get current commit SHA for tagging
      const commitSha = await $`git rev-parse HEAD`;
      const sha = commitSha.stdout.trim();

      // Force push to stage
      await $`git push origin ${this.mergeStageBranch}:${this.stageBranch} --force`;

      // Create tag for tracking
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const tagName = `stage-${timestamp}`;
      await $`git tag ${tagName}`;
      await $`git push origin ${tagName}`;

      console.log(chalk.green(`✓ Force pushed ${this.mergeStageBranch} to ${this.stageBranch}`));
      console.log(chalk.gray(`  Tagged as: ${tagName}`));

      return sha;
    } catch (error) {
      throw new Error(`Failed to force push to stage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Merge stage branch to main branch
   * Uses fetch/push operations without checking out branches in main repo
   */
  async mergeStageToMain(): Promise<MergeResult> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Fetch latest changes
      await $`git fetch origin`;

      // Update local main branch without checking it out
      await $`git fetch origin ${this.mainBranch}:${this.mainBranch}`;

      // Create a temporary worktree for the merge operation
      const tempWorktreePath = `${this.projectPath}/.worktrees/temp_main_merge`;
      
      try {
        // Remove temp worktree if it exists from previous run
        await $`git worktree remove ${tempWorktreePath} --force`;
      } catch {
        // Doesn't exist, that's fine
      }

      // Create temp worktree on main branch
      await $`git worktree add ${tempWorktreePath} ${this.mainBranch}`;

      // Set cwd to temp worktree
      $.cwd = tempWorktreePath;

      // Attempt merge with no-ff to preserve history
      try {
        const mergeMessage = `Merge ${this.stageBranch} into ${this.mainBranch}`;
        await $`git merge --no-ff -m ${mergeMessage} origin/${this.stageBranch}`;

        // Get the commit SHA
        const commitSha = await $`git rev-parse HEAD`;
        const sha = commitSha.stdout.trim();

        // Push to main
        await $`git push origin ${this.mainBranch}`;

        console.log(chalk.green(`✓ Merged ${this.stageBranch} to ${this.mainBranch}`));
        console.log(chalk.gray(`  Commit: ${sha.substring(0, 7)}`));

        // Clean up temp worktree
        $.cwd = this.projectPath;
        await $`git worktree remove ${tempWorktreePath} --force`;

        return {
          success: true,
          hasConflicts: false,
          commitSha: sha,
        };
      } catch (error) {
        // Check if it's a merge conflict
        const status = await $`git status --porcelain`;
        const conflictLines = status.stdout.split('\n').filter(line => line.startsWith('UU '));

        // Clean up temp worktree on error
        $.cwd = this.projectPath;
        try {
          await $`git worktree remove ${tempWorktreePath} --force`;
        } catch {
          // Cleanup failed, not critical
        }

        if (conflictLines.length > 0) {
          // Extract conflict file paths
          const conflictFiles = conflictLines.map(line => line.substring(3).trim());

          return {
            success: false,
            hasConflicts: true,
            conflictFiles,
          };
        }

        // Some other merge error
        return {
          success: false,
          hasConflicts: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } catch (error) {
      // Ensure we're back in main project path
      $.cwd = this.projectPath;
      
      return {
        success: false,
        hasConflicts: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if a branch exists (local or remote)
   */
  async branchExists(branchName: string): Promise<boolean> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Check local
      const localBranches = await $`git branch --list ${branchName}`;
      if (localBranches.stdout.trim().length > 0) {
        return true;
      }

      // Check remote
      const remoteBranches = await $`git branch -r --list origin/${branchName}`;
      if (remoteBranches.stdout.trim().length > 0) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Delete merge_stage branch and worktree
   */
  async deleteMergeStage(): Promise<void> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Remove worktree first
      try {
        await $`git worktree remove ${this.mergeStageWorktreePath} --force`;
      } catch {
        // Worktree might not exist, that's okay
      }

      // Delete local branch
      await $`git branch -D ${this.mergeStageBranch}`;
      console.log(chalk.gray(`✓ Deleted local ${this.mergeStageBranch} branch and worktree`));
    } catch (error) {
      // Branch might not exist, that's okay
    }
  }

  /**
   * Get diff between merge_stage and main
   */
  async getDiffWithMain(): Promise<string> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      const diff = await $`git diff ${this.mainBranch}..${this.mergeStageBranch}`;
      return diff.stdout;
    } catch (error) {
      throw new Error(`Failed to get diff: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get list of commits on merge_stage not on main
   */
  async getCommitsSinceMain(): Promise<Array<{ sha: string; message: string }>> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      const commits = await $`git log ${this.mainBranch}..${this.mergeStageBranch} --pretty=format:%H|%s`;
      const lines = commits.stdout.trim().split('\n').filter(l => l);

      return lines.map(line => {
        const [sha, message] = line.split('|');
        return { sha, message };
      });
    } catch {
      return [];
    }
  }
}