/**
 * ReviewWorker - Standalone code review system using personas
 *
 * Can review code in any branch and optionally update issue status based on results.
 * Used for both automated review workflows and manual on-demand reviews.
 */

import chalk from 'chalk';
import { $ } from 'zx';
import { AssignmentManager } from './assignment-manager.js';
import { PersonaReviewer, ReviewResult } from './persona-reviewer.js';
import { Assignment } from '../types/index.js';
import { GitHubAPI } from '../github/api.js';
import { ProjectFieldMapper } from '../github/project-field-mapper.js';

export interface ReviewWorkerOptions {
  passStatus?: string;   // Status to set if review passes (e.g., "Dev Complete")
  failStatus?: string;   // Status to set if review fails (e.g., "Failed Review")
  branch?: string;       // Branch to review (defaults to current branch)
  verbose?: boolean;
  quiet?: boolean;       // Suppress detailed logging (for batch operations)
  personas?: string[];   // Personas to run (defaults to ['architect'])
  useCurrentDirectory?: boolean; // Use current working directory instead of looking for worktree
}

export interface ReviewJobResult {
  issueNumber: number;
  issueTitle: string;
  passed: boolean;
  reviewResult: ReviewResult;
  statusUpdated: boolean;
  commentPosted: boolean;
  commentUrl?: string;
}

export class ReviewWorker {
  private assignmentManager: AssignmentManager;
  private personaReviewer: PersonaReviewer;
  private githubAPI: GitHubAPI | null;
  private projectPath: string;
  private maxConcurrent: number;
  private fieldMapper: ProjectFieldMapper | null;

  constructor(
    projectPath: string,
    assignmentManager: AssignmentManager,
    githubAPI: GitHubAPI | null,
    claudePath: string = 'claude',
    maxConcurrent: number = 3,
    fieldMapper: ProjectFieldMapper | null = null
  ) {
    this.projectPath = projectPath;
    this.assignmentManager = assignmentManager;
    this.githubAPI = githubAPI;
    this.personaReviewer = new PersonaReviewer(projectPath, claudePath);
    this.maxConcurrent = maxConcurrent;
    this.fieldMapper = fieldMapper;
  }

  /**
   * Review multiple assignments with a given filter status
   */
  async reviewAssignmentsByStatus(
    filterStatus: string,
    options: ReviewWorkerOptions = {}
  ): Promise<ReviewJobResult[]> {
    let issueNumbers: number[] = [];

    // If we have field mapper, query GitHub Projects directly
    if (this.fieldMapper) {
      console.log(chalk.gray(`Querying GitHub Projects for items with status: ${filterStatus}...`));
      const items = await this.fieldMapper.getItemsByStatus(filterStatus);
      issueNumbers = items.map(item => item.issueNumber);
      console.log(chalk.gray(`Found ${issueNumbers.length} items in GitHub Projects\n`));
    } else {
      // Fallback: use local assignments only
      const allAssignments = this.assignmentManager.getAllAssignments();
      const assignments = allAssignments.filter(a => {
        // Match against both local status and GitHub status
        return a.status === filterStatus || this.matchesGitHubStatus(a, filterStatus);
      });
      issueNumbers = assignments.map(a => a.issueNumber);
    }

    if (issueNumbers.length === 0) {
      console.log(chalk.yellow(`No items found with status: ${filterStatus}`));
      return [];
    }

    console.log(chalk.blue.bold(`\n🔍 Review Worker Starting...`));
    console.log(chalk.gray(`  Found ${issueNumbers.length} issue(s) to review`));
    console.log(chalk.gray(`  Processing ${this.maxConcurrent} at a time\n`));

    const results: ReviewJobResult[] = [];

    // Process issues in batches with concurrency control
    for (let i = 0; i < issueNumbers.length; i += this.maxConcurrent) {
      const batch = issueNumbers.slice(i, i + this.maxConcurrent);
      const batchNumber = Math.floor(i / this.maxConcurrent) + 1;
      const totalBatches = Math.ceil(issueNumbers.length / this.maxConcurrent);

      console.log(chalk.cyan(`\n📦 Batch ${batchNumber}/${totalBatches} (${batch.length} reviews)\n`));

      // Process batch concurrently - review by issue number with quiet mode enabled
      const batchResults = await Promise.all(
        batch.map(issueNumber => this.reviewByIssueNumber(issueNumber, { ...options, quiet: true }))
      );

      // Filter out null results and push to results
      results.push(...batchResults.filter(r => r !== null) as ReviewJobResult[]);

      // Show batch summary
      const batchPassed = batchResults.filter(r => r && r.passed).length;
      const batchFailed = batchResults.filter(r => r && !r.passed).length;
      console.log(chalk.gray(`  Batch complete: ${batchPassed} passed, ${batchFailed} failed`));
    }

    // Summary
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log(chalk.blue.bold(`\n📊 Review Summary:`));
    console.log(chalk.green(`  Passed: ${passed}`));
    console.log(chalk.red(`  Failed: ${failed}`));
    console.log(chalk.gray(`  Total: ${results.length}\n`));

    return results;
  }

  /**
   * Review a single assignment by issue number
   */
  async reviewByIssueNumber(
    issueNumber: number,
    options: ReviewWorkerOptions = {}
  ): Promise<ReviewJobResult | null> {
    // If user explicitly specified a branch, review that branch
    // Otherwise, review current working directory against issue requirements

    if (!this.githubAPI) {
      console.error(chalk.red(`\n✗ Cannot review issue #${issueNumber}: No GitHub API available`));
      return null;
    }

    try {
      const issue = await this.githubAPI.getIssue(issueNumber);

      // Determine branch name and whether to use current directory
      let branch: string;
      let useCurrentDirectory = false;

      if (options.branch) {
        // User specified branch - may need to look for worktree
        branch = options.branch;
        useCurrentDirectory = false;
      } else {
        // No branch specified - use current working directory
        branch = await this.getCurrentBranch();
        useCurrentDirectory = true;
      }

      return await this.reviewIssue(issueNumber, issue.title, issue.body || '', branch, {
        ...options,
        useCurrentDirectory,
      });
    } catch (error) {
      console.error(chalk.red(`\n✗ Failed to fetch issue #${issueNumber}:`), error);
      return null;
    }
  }

  /**
   * Get current git branch
   */
  private async getCurrentBranch(): Promise<string> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      const result = await $`git branch --show-current`;
      return result.stdout.trim();
    } catch (error) {
      console.error(chalk.yellow(`  ⚠️  Could not determine current branch, defaulting to 'main'`));
      return 'main';
    }
  }

  /**
   * Review a GitHub issue (without assignment)
   */
  private async reviewIssue(
    issueNumber: number,
    issueTitle: string,
    issueBody: string,
    branch: string,
    options: ReviewWorkerOptions = {}
  ): Promise<ReviewJobResult> {
    if (!options.quiet) {
      console.log(chalk.cyan.bold(`\n━━━ Reviewing Issue #${issueNumber} ━━━`));
      console.log(chalk.cyan(`  Title: ${issueTitle}`));
      console.log(chalk.cyan(`  Branch: ${branch}\n`));
    }

    let reviewResult: ReviewResult;
    let statusUpdated = false;
    let commentUrl: string | null = null;

    try {
      // If user specified a branch explicitly, verify it exists as a worktree or in current directory
      if (!options.useCurrentDirectory) {
        const worktreePath = await this.getWorktreePath(branch);

        if (!worktreePath) {
          // No worktree found - check if branch exists in current directory
          const currentBranch = await this.getCurrentBranch();

          if (currentBranch !== branch) {
            // Branch doesn't match current and no worktree exists
            const errorMsg = `Branch '${branch}' not found. No worktree exists for this branch and it's not the current branch.`;
            console.error(chalk.red(`\n✗ ${errorMsg}`));
            console.log(chalk.gray(`  Current branch: ${currentBranch}`));
            console.log(chalk.gray(`  Hint: Either checkout '${branch}' or omit --branch to review current directory\n`));

            return {
              issueNumber,
              issueTitle,
              passed: false,
              reviewResult: {
                overallPassed: false,
                personaReviews: [],
                failureReasons: [errorMsg],
              },
              statusUpdated: false,
              commentPosted: false,
            };
          }
          // Branch matches current, proceed with current directory
          options.useCurrentDirectory = true;
        }
      }

      // Check for unpushed changes in worktree (skip if using current directory)
      if (!options.useCurrentDirectory) {
        const unpushedChanges = await this.checkUnpushedChanges(branch);
        if (unpushedChanges.hasUnpushedCode) {
          if (!options.quiet) {
            console.log(chalk.yellow(`  ⚠️  Warning: Worktree has unpushed code changes`));
            console.log(chalk.yellow(`      This may indicate the status was set prematurely`));
            console.log(chalk.gray(`      Unpushed files: ${unpushedChanges.unpushedFiles.join(', ')}`));
          }

          // Create a special review result for unpushed changes
          reviewResult = {
            overallPassed: false,
            personaReviews: [],
            failureReasons: [
              `Worktree has unpushed code changes (${unpushedChanges.unpushedFiles.length} files)`,
              'Status may have been set prematurely - work appears incomplete',
              `Unpushed files: ${unpushedChanges.unpushedFiles.slice(0, 5).join(', ')}${unpushedChanges.unpushedFiles.length > 5 ? '...' : ''}`
            ],
          };

          // Post warning comment to GitHub
          if (this.githubAPI) {
            commentUrl = await this.postReviewComment(issueNumber, reviewResult, options.quiet);
          }

          // Update status to indicate incomplete work if fail status provided
          if (this.fieldMapper && options.failStatus) {
            try {
              await this.updateIssueStatus(issueNumber, options.failStatus);
              statusUpdated = true;
              if (!options.quiet) {
                console.log(chalk.yellow(`  ⚠️  Status updated to: ${options.failStatus} (unpushed changes detected)`));
              }
            } catch (error) {
              console.error(chalk.red(`  ✗ Failed to update status:`), error instanceof Error ? error.message : String(error));
            }
          }

          return {
            issueNumber,
            issueTitle,
            passed: false,
            reviewResult,
            statusUpdated,
            commentPosted: commentUrl !== null,
            commentUrl: commentUrl || undefined,
          };
        }
      }

      // Get diff for the branch (always empty for requirements verification)
      const diff = await this.getDiffForBranch(branch);

      // We're doing requirements verification against the branch state
      if (!options.quiet) {
        console.log(chalk.blue(`  ℹ️  Verifying requirements on branch: ${branch}`));
      }

      // Create a minimal assignment-like object for review
      const pseudoAssignment = {
        issueNumber,
        issueTitle,
        issueBody,
        branchName: branch,
        worktreePath: this.projectPath,
      };

      // Run persona review in requirements verification mode
      reviewResult = await this.personaReviewer.reviewChanges(pseudoAssignment as any, {
        worktreePath: this.projectPath,
        branchName: branch,
        diff,
        quiet: options.quiet,
        personas: options.personas,
      });

      // Post results to GitHub
      if (this.githubAPI) {
        commentUrl = await this.postReviewComment(issueNumber, reviewResult, options.quiet);
      }

      // Update status if pass/fail statuses provided and we have field mapper
      if (this.fieldMapper && options.passStatus && reviewResult.overallPassed) {
        try {
          await this.updateIssueStatus(issueNumber, options.passStatus);
          statusUpdated = true;
          if (!options.quiet) {
            console.log(chalk.green(`  ✓ Status updated to: ${options.passStatus}`));
          }
        } catch (error) {
          console.error(chalk.red(`  ✗ Failed to update status:`), error instanceof Error ? error.message : String(error));
        }
      } else if (this.fieldMapper && options.failStatus && !reviewResult.overallPassed) {
        try {
          await this.updateIssueStatus(issueNumber, options.failStatus);
          statusUpdated = true;
          if (!options.quiet) {
            console.log(chalk.yellow(`  ⚠️  Status updated to: ${options.failStatus}`));
          }
        } catch (error) {
          console.error(chalk.red(`  ✗ Failed to update status:`), error instanceof Error ? error.message : String(error));
        }
      }

      return {
        issueNumber,
        issueTitle,
        passed: reviewResult.overallPassed,
        reviewResult,
        statusUpdated,
        commentPosted: commentUrl !== null,
        commentUrl: commentUrl || undefined,
      };
    } catch (error) {
      console.error(chalk.red(`\n✗ Error reviewing issue #${issueNumber}:`), error);

      return {
        issueNumber,
        issueTitle,
        passed: false,
        reviewResult: {
          overallPassed: false,
          personaReviews: [],
          failureReasons: [`Review error: ${error instanceof Error ? error.message : String(error)}`],
        },
        statusUpdated: false,
        commentPosted: false,
      };
    }
  }


  /**
   * Get diff for a specific branch compared to main
   * Returns empty string to trigger requirements verification mode
   */
  private async getDiffForBranch(_branch: string): Promise<string> {
    // Always return empty string to force requirements verification mode
    // We want to verify requirements against the branch state, not review diffs
    return '';
  }

  /**
   * Post review results as a GitHub issue comment
   */
  private async postReviewComment(issueNumber: number, reviewResult: ReviewResult, quiet = false): Promise<string | null> {
    if (!this.githubAPI) {
      return null;
    }

    try {
      const comment = this.formatReviewComment(reviewResult);
      const commentUrl = await this.githubAPI.createComment(issueNumber, comment);
      if (!quiet) {
        console.log(chalk.gray('  ✓ Review results posted to GitHub'));
      }
      return commentUrl;
    } catch (error) {
      if (!quiet) {
        console.error(chalk.yellow('  ⚠️  Could not post comment to GitHub'));
        console.error(chalk.red(`     Error: ${error instanceof Error ? error.message : String(error)}`));
      }
      return null;
    }
  }

  /**
   * Format review results as a GitHub comment
   */
  private formatReviewComment(reviewResult: ReviewResult): string {
    if (reviewResult.overallPassed) {
      // Simple pass message
      return `## ✅ Code Review: PASSED

All persona reviews passed successfully!

**Review Summary:**
- **Status:** PASSED
- **Reviewers:** ${reviewResult.personaReviews.length} personas
- **Result:** All criteria met

---
*Automated by Review Worker*`;
    }

    // Detailed failure message
    const failedReviews = reviewResult.personaReviews.filter(r => !r.passed);
    const passedReviews = reviewResult.personaReviews.filter(r => r.passed);

    const feedbackSections = failedReviews.map(review => {
      const personaName = review.persona
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      return `### ${personaName} Review: ❌ FAILED

${review.feedback}

${review.score ? `**Score:** ${review.score}/10` : ''}`;
    }).join('\n\n');

    const passedList = passedReviews.length > 0
      ? `\n**Passed Reviews:**\n${passedReviews.map(r => `- ${r.persona.replace(/-/g, ' ')}`).join('\n')}\n`
      : '';

    return `## ❌ Code Review: FAILED

The code changes did not pass all persona reviews. Please address the issues below:

${feedbackSections}

---

**Review Summary:**
- **Status:** FAILED
- **Passed:** ${passedReviews.length}/${reviewResult.personaReviews.length}
- **Failed:** ${failedReviews.length}/${reviewResult.personaReviews.length}

${passedList}
**What to do next:**
1. Read the feedback from each failed review above
2. Make the necessary changes to address the concerns
3. Update your branch with the fixes
4. The review will run again automatically (or request a re-review)

---
*Automated by Review Worker*`;
  }

  /**
   * Update issue status directly via Projects API
   */
  private async updateIssueStatus(issueNumber: number, newStatus: string): Promise<void> {
    if (!this.fieldMapper) {
      throw new Error(`No field mapper available for issue #${issueNumber}`);
    }

      // Get the project item ID for this issue
    const metadata = await this.fieldMapper.getMetadataForIssue(issueNumber);

    if (!metadata) {
      throw new Error(`Could not find project item for issue #${issueNumber}`);
    }

    // Update status via Projects API using the string value method
    const projectsAPI = (this.fieldMapper as any).projectsAPI;

    if (projectsAPI && projectsAPI.updateItemStatusByValue) {
      await projectsAPI.updateItemStatusByValue(metadata.projectItemId, newStatus);
    } else {
      throw new Error(`updateItemStatusByValue not available on projectsAPI`);
    }
  }

  /**
   * Check if assignment matches a GitHub status
   */
  private matchesGitHubStatus(assignment: Assignment, githubStatus: string): boolean {
    // This is a simple check - in practice you'd want to check the actual GitHub status
    // For now, just match common patterns
    const statusMap: Record<string, string[]> = {
      'In Review': ['dev-complete'],
      'Dev Complete': ['dev-complete'],
      'In Progress': ['in-progress'],
      'Todo': ['assigned'],
      'Failed Review': ['assigned'],
    };

    const matchingStatuses = statusMap[githubStatus] || [];
    return matchingStatuses.includes(assignment.status);
  }

  /**
   * Check if worktree has unpushed code changes
   */
  private async checkUnpushedChanges(branch: string): Promise<{
    hasUnpushedCode: boolean;
    unpushedFiles: string[];
  }> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      // First, find the worktree path for this branch
      const worktreePath = await this.getWorktreePath(branch);

      if (!worktreePath) {
        // No worktree, can't check for unpushed changes
        return { hasUnpushedCode: false, unpushedFiles: [] };
      }

      // Switch to worktree directory
      const originalCwd = $.cwd;
      $.cwd = worktreePath;

      try {
        // Check for uncommitted changes first
        const statusResult = await $`git status --porcelain`;
        const uncommittedFiles = statusResult.stdout
          .split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => line.substring(3).trim()); // Remove status prefix

        // Filter out non-code files (hooks, config, etc.)
        const uncommittedCodeFiles = uncommittedFiles.filter(file =>
          this.isCodeFile(file)
        );

        if (uncommittedCodeFiles.length > 0) {
          $.cwd = originalCwd;
          return {
            hasUnpushedCode: true,
            unpushedFiles: uncommittedCodeFiles
          };
        }

        // Check for unpushed commits
        try {
          // Get remote tracking branch
          const trackingBranch = await $`git rev-parse --abbrev-ref --symbolic-full-name @{u}`.catch(() => null);

          if (trackingBranch && trackingBranch.stdout.trim()) {
            // Check for commits not pushed to remote
            const unpushedCommits = await $`git log ${trackingBranch.stdout.trim()}..HEAD --oneline`;

            if (unpushedCommits.stdout.trim().length > 0) {
              // Get files changed in unpushed commits
              const diffFiles = await $`git diff --name-only ${trackingBranch.stdout.trim()}..HEAD`;
              const unpushedFiles = diffFiles.stdout
                .split('\n')
                .filter(line => line.trim().length > 0);

              const unpushedCodeFiles = unpushedFiles.filter(file =>
                this.isCodeFile(file)
              );

              $.cwd = originalCwd;
              return {
                hasUnpushedCode: unpushedCodeFiles.length > 0,
                unpushedFiles: unpushedCodeFiles
              };
            }
          }
        } catch {
          // No tracking branch or error checking, not necessarily a problem
        }

        $.cwd = originalCwd;
        return { hasUnpushedCode: false, unpushedFiles: [] };
      } finally {
        $.cwd = originalCwd;
      }
    } catch (error) {
      // Silently fail and assume no unpushed changes
      return { hasUnpushedCode: false, unpushedFiles: [] };
    }
  }

  /**
   * Get worktree path for a branch
   */
  private async getWorktreePath(branch: string): Promise<string | null> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      const worktreeList = await $`git worktree list --porcelain`;
      const worktrees = worktreeList.stdout.split('\n\n');

      for (const worktree of worktrees) {
        const lines = worktree.split('\n');
        const worktreePath = lines.find(l => l.startsWith('worktree '))?.replace('worktree ', '');
        const branchLine = lines.find(l => l.startsWith('branch '));

        if (branchLine && worktreePath) {
          const wtBranch = branchLine.replace('branch refs/heads/', '');
          if (wtBranch === branch) {
            return worktreePath;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if file is a code file (not hooks, config, etc.)
   */
  private isCodeFile(filepath: string): boolean {
    // Ignore hook files
    if (filepath.includes('.claude') || filepath.includes('claude_hooks')) {
      return false;
    }

    // Ignore common config files that aren't code
    const ignoredPatterns = [
      /\.md$/i,
      /\.txt$/i,
      /\.json$/i,
      /\.yaml$/i,
      /\.yml$/i,
      /\.lock$/i,
      /package-lock\.json$/i,
      /yarn\.lock$/i,
      /\.env/i,
      /\.gitignore$/i,
      /\.prettierrc/i,
      /\.eslintrc/i,
    ];

    // If it matches ignored patterns, it's not a "code" file for our purposes
    if (ignoredPatterns.some(pattern => pattern.test(filepath))) {
      return false;
    }

    // Accept actual code files
    const codePatterns = [
      /\.(ts|tsx|js|jsx)$/i,
      /\.(py|rb|go|rs|java|c|cpp|h|hpp)$/i,
      /\.(css|scss|sass|less)$/i,
      /\.(html|vue|svelte)$/i,
    ];

    return codePatterns.some(pattern => pattern.test(filepath));
  }

  /**
   * Set custom personas for review
   */
  setPersonas(personas: any[]): void {
    this.personaReviewer.setPersonas(personas);
  }
}
