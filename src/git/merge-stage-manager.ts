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

  constructor(projectPath: string, options: MergeStageBranchManagerOptions = {}) {
    this.projectPath = projectPath;
    this.mainBranch = options.mainBranch || 'main';
    this.stageBranch = options.stageBranch || 'stage';
    this.mergeStageBranch = options.mergeStageBranch || 'merge_stage';
  }

  /**
   * Create or reset merge_stage branch from main
   */
  async createOrResetMergeStage(): Promise<void> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Fetch latest from remote
      await $`git fetch origin`;

      // Check if merge_stage exists locally
      const branches = await $`git branch --list ${this.mergeStageBranch}`;
      const exists = branches.stdout.trim().length > 0;

      if (exists) {
        // Delete existing merge_stage
        await $`git branch -D ${this.mergeStageBranch}`;
      }

      // Check if we're currently on merge_stage (shouldn't happen, but safe check)
      const currentBranch = await $`git rev-parse --abbrev-ref HEAD`;
      if (currentBranch.stdout.trim() === this.mergeStageBranch) {
        // Switch away from merge_stage before deleting
        await $`git checkout ${this.mainBranch}`;
      }

      // Update main branch
      await $`git checkout ${this.mainBranch}`;
      await $`git pull origin ${this.mainBranch}`;

      // Create fresh merge_stage from main
      await $`git checkout -b ${this.mergeStageBranch}`;

      console.log(chalk.green(`✓ Created fresh ${this.mergeStageBranch} from ${this.mainBranch}`));
    } catch (error) {
      throw new Error(`Failed to create/reset merge_stage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Merge a feature branch into merge_stage
   */
  async mergeFeatureBranch(branchName: string, issueNumber: number): Promise<MergeResult> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Ensure we're on merge_stage
      const currentBranch = await $`git rev-parse --abbrev-ref HEAD`;
      if (currentBranch.stdout.trim() !== this.mergeStageBranch) {
        await $`git checkout ${this.mergeStageBranch}`;
      }

      // Fetch the feature branch
      try {
        await $`git fetch origin ${branchName}`;
      } catch {
        // Branch might only exist locally
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
   * Detect if there are currently unresolved conflicts
   */
  async hasUnresolvedConflicts(): Promise<boolean> {
    $.cwd = this.projectPath;
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
   * Get list of files with conflicts
   */
  async getConflictFiles(): Promise<string[]> {
    $.cwd = this.projectPath;
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
   * Abort current merge
   */
  async abortMerge(): Promise<void> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      await $`git merge --abort`;
    } catch (error) {
      throw new Error(`Failed to abort merge: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stage all resolved files and commit
   */
  async commitResolvedConflicts(message: string): Promise<string> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Stage all files (conflicts should be resolved at this point)
      await $`git add .`;

      // Commit the merge
      await $`git commit -m ${message}`;

      // Get the commit SHA
      const commitSha = await $`git rev-parse HEAD`;
      return commitSha.stdout.trim();
    } catch (error) {
      throw new Error(`Failed to commit resolved conflicts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Force push merge_stage to stage branch
   */
  async forcePushToStage(): Promise<string> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Ensure we're on merge_stage
      const currentBranch = await $`git rev-parse --abbrev-ref HEAD`;
      if (currentBranch.stdout.trim() !== this.mergeStageBranch) {
        throw new Error(`Not on ${this.mergeStageBranch} branch`);
      }

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
   * Merge stage branch to main
   * Used in epic mode with auto-merge to main enabled
   */
  async mergeStageToMain(): Promise<MergeResult> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Fetch latest changes
      await $`git fetch origin`;

      // Checkout and update main
      await $`git checkout ${this.mainBranch}`;
      await $`git pull origin ${this.mainBranch}`;

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

        return {
          success: true,
          hasConflicts: false,
          commitSha: sha,
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
   * Delete merge_stage branch (cleanup)
   */
  async deleteMergeStage(): Promise<void> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // Switch away from merge_stage if we're on it
      const currentBranch = await $`git rev-parse --abbrev-ref HEAD`;
      if (currentBranch.stdout.trim() === this.mergeStageBranch) {
        await $`git checkout ${this.mainBranch}`;
      }

      // Delete local branch
      await $`git branch -D ${this.mergeStageBranch}`;
      console.log(chalk.gray(`✓ Deleted local ${this.mergeStageBranch} branch`));
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
