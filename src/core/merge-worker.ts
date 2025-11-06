/**
 * MergeWorker - Handles automated merging, conflict resolution, and review
 *
 * Single-instance worker that:
 * 1. Monitors for dev-complete assignments
 * 2. Merges them to merge_stage branch
 * 3. Resolves conflicts automatically
 * 4. Reviews changes with personas
 * 5. Force pushes to stage if approved
 * 6. Sends back to Todo if rejected
 */

import chalk from 'chalk';
import { AssignmentManager } from './assignment-manager.js';
import { MergeStageBranchManager } from '../git/merge-stage-manager.js';
import { ConflictResolver } from '../git/conflict-resolver.js';
import { PersonaReviewer, ReviewResult } from './persona-reviewer.js';
import { Assignment } from '../types/index.js';
import { GitHubAPI } from '../github/api.js';
import { GitHubProjectsAPI } from '../github/projects-api.js';

export interface MergeWorkerConfig {
  enabled: boolean;
  claudePath?: string;
  mainBranch?: string;
  stageBranch?: string;
  requireAllPersonasPass?: boolean;
  autoResolveConflicts?: boolean;
  evaluateValue?: string; // Status value to set when rejecting (e.g., "Evaluate")
  autoMergeToMain?: boolean; // Automatically merge stage to main (epic mode)
  epicMode?: boolean; // Epic orchestration mode - only process phase masters
}

export class MergeWorker {
  private assignmentManager: AssignmentManager;
  private branchManager: MergeStageBranchManager;
  private conflictResolver: ConflictResolver;
  private personaReviewer: PersonaReviewer;
  private githubAPI: GitHubAPI | null;
  private projectsAPI: GitHubProjectsAPI | null;
  private config: MergeWorkerConfig;
  private isRunning = false;
  private verbose: boolean;

  constructor(
    projectPath: string,
    assignmentManager: AssignmentManager,
    githubAPI: GitHubAPI | null,
    projectsAPI: GitHubProjectsAPI | null,
    config: MergeWorkerConfig,
    verbose: boolean = false
  ) {
    this.assignmentManager = assignmentManager;
    this.verbose = verbose;
    this.githubAPI = githubAPI;
    this.projectsAPI = projectsAPI;
    this.config = config;

    const claudePath = config.claudePath || 'claude';
    this.branchManager = new MergeStageBranchManager(projectPath, {
      mainBranch: config.mainBranch,
      stageBranch: config.stageBranch,
    });
    this.conflictResolver = new ConflictResolver(projectPath, claudePath);
    this.personaReviewer = new PersonaReviewer(projectPath, claudePath);
  }

  /**
   * Log workflow event (visible even without --verbose)
   */
  private logEvent(emoji: string, message: string, details?: string): void {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${chalk.gray(`[${timestamp}]`)} ${emoji}  ${chalk.bold(message)}`);
    if (details) {
      console.log(chalk.gray(`  ${details}`));
    }
  }

  /**
   * Check if an assignment is a phase master ticket
   * Phase master detection:
   * - Title contains "MASTER" keyword (required)
   * - Title contains "Phase N" where N is an integer (NOT decimal like Phase 7.2)
   */
  private isPhaseMaster(assignment: Assignment): boolean {
    const title = assignment.issueTitle;

    // MUST have MASTER keyword
    const hasMaster = /MASTER/i.test(title);
    if (!hasMaster) {
      return false;
    }

    // Check for decimal phase pattern (Phase N.M) - these are work items, NOT masters
    const hasDecimalPhase = /Phase\s+\d+\.\d+/i.test(title);
    if (hasDecimalPhase) {
      return false; // Decimal phase = work item, even with MASTER keyword
    }

    // Has MASTER and doesn't have decimal phase = master item
    return true;
  }

  /**
   * Extract phase number from phase master title
   * Returns null if no phase number found
   */
  private extractPhaseNumber(title: string): number | null {
    const phaseMatch = title.match(/Phase\s+(\d+)/i);
    return phaseMatch ? parseInt(phaseMatch[1], 10) : null;
  }

  /**
   * Update all work items in a phase to match the master's status
   * Only runs in epic mode
   */
  private async syncPhaseItemStatuses(
    masterAssignment: Assignment,
    newStatus: 'stage-ready' | 'merged'
  ): Promise<void> {
    if (!this.config.epicMode) {
      return; // Only run in epic mode
    }

    const phaseNumber = this.extractPhaseNumber(masterAssignment.issueTitle);
    if (!phaseNumber) {
      console.log(chalk.yellow(`  ⚠️  Could not extract phase number from: ${masterAssignment.issueTitle}`));
      return;
    }

    console.log(chalk.blue(`\n📦 Syncing all Phase ${phaseNumber} items to status: ${newStatus}`));

    // Update local assignments that belong to this phase (work items)
    const allAssignments = this.assignmentManager.getAllAssignments();
    const phasePattern = new RegExp(`Phase\\s+${phaseNumber}\\.\\d+`, 'i');

    const phaseWorkItems = allAssignments.filter(assignment => {
      return phasePattern.test(assignment.issueTitle) && assignment.id !== masterAssignment.id;
    });

    for (const workItem of phaseWorkItems) {
      try {
        await this.assignmentManager.updateStatusWithSync(workItem.id, newStatus);

        // Clear assigned instance if merged
        if (newStatus === 'merged') {
          await this.assignmentManager.updateAssignedInstanceWithSync(workItem.id, null);
        }

        console.log(chalk.gray(`  ✓ #${workItem.issueNumber}: ${workItem.issueTitle.substring(0, 60)}...`));
      } catch (error) {
        console.log(chalk.yellow(`  ⚠️  Failed to update #${workItem.issueNumber}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    // Also update GitHub Project directly for ALL phase items (including master)
    // This ensures items without local assignments are also updated
    if (this.projectsAPI) {
      try {
        // Query all project items
        const queryResult = await this.projectsAPI.queryItems();
        const allProjectItems = queryResult.items;

        // Find all Phase N items (master + work items)
        const phaseMasterPattern = new RegExp(`Phase\\s+${phaseNumber}(?!\\.)`, 'i');
        const phaseWorkPattern = new RegExp(`Phase\\s+${phaseNumber}\\.\\d+`, 'i');

        const phaseItems: Array<{ issueNumber: number; title: string; projectItemId: string; isMaster: boolean }> = [];
        
        for (const item of allProjectItems) {
          const title = item.content?.title || '';
          const issueNumber = item.content?.number;

          if (item.id && issueNumber) {
            const isMaster = phaseMasterPattern.test(title);
            const isWorkItem = phaseWorkPattern.test(title);
            
            if (isMaster || isWorkItem) {
              phaseItems.push({
                issueNumber,
                title,
                projectItemId: item.id,
                isMaster,
              });
            }
          }
        }

        if (phaseItems.length > 0) {
          console.log(chalk.blue(`\n📋 Updating ${phaseItems.length} item(s) in GitHub Project...`));
          
          for (const item of phaseItems) {
            try {
              await this.projectsAPI.updateItemStatus(item.projectItemId, newStatus);
              
              // Clear assigned instance if merged
              if (newStatus === 'merged') {
                await this.projectsAPI.updateAssignedInstance(item.projectItemId, '');
              }
              
              const label = item.isMaster ? 'MASTER' : 'work item';
              console.log(chalk.gray(`  ✓ #${item.issueNumber} (${label}): ${item.title.substring(0, 50)}...`));
            } catch (error) {
              console.log(chalk.yellow(`  ⚠️  Failed to update #${item.issueNumber} in project: ${error}`));
            }
          }
        }
      } catch (error) {
        console.log(chalk.yellow(`\n⚠️  Could not query GitHub Project for phase items: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
  }

  /**
   * Process all dev-complete assignments
   * In epic mode, only processes phase master tickets
   */
  async processDevCompleteItems(): Promise<void> {
    if (this.isRunning) {
      console.log(chalk.yellow('⚠️  Merge worker already running, skipping...'));
      return;
    }

    let devCompleteItems = this.assignmentManager.getAssignmentsByStatus('dev-complete');

    if (devCompleteItems.length === 0) {
      return;
    }

    // Epic mode: Filter to only phase master tickets
    if (this.config.epicMode) {
      const allItems = devCompleteItems.length;
      devCompleteItems = devCompleteItems.filter(item => this.isPhaseMaster(item));

      if (this.verbose && devCompleteItems.length < allItems) {
        console.log(chalk.blue(`\n📋 Epic Mode: Filtered to ${devCompleteItems.length} phase master(s) from ${allItems} dev-complete item(s)`));
        const skipped = allItems - devCompleteItems.length;
        console.log(chalk.gray(`  Skipped ${skipped} work item(s) - will merge with phase master\n`));
      }

      if (devCompleteItems.length === 0) {
        if (this.verbose) {
          console.log(chalk.gray('  No phase masters ready for merge\n'));
        }
        return;
      }
    }

    if (this.verbose) {
      console.log(chalk.blue.bold(`\n🔄 Merge Worker Starting...`));
      console.log(chalk.gray(`  Processing ${devCompleteItems.length} item(s)\n`));
    } else {
      this.logEvent('🔄', `Merge worker processing ${devCompleteItems.length} item(s)`);
    }

    this.isRunning = true;

    try {
      // Create/reset merge_stage from main
      await this.branchManager.createOrResetMergeStage();

      // Process items one by one
      for (const assignment of devCompleteItems) {
        await this.processItem(assignment);
      }

      console.log(chalk.green.bold(`\n✓ Merge Worker Completed\n`));
    } catch (error) {
      console.error(chalk.red(`\n✗ Merge Worker Error:`), error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process a single dev-complete item
   */
  private async processItem(assignment: Assignment): Promise<void> {
    console.log(chalk.cyan.bold(`\n━━━ Processing Issue #${assignment.issueNumber} ━━━`));
    console.log(chalk.cyan(`  Title: ${assignment.issueTitle}`));
    console.log(chalk.cyan(`  Branch: ${assignment.branchName}\n`));

    try {
      // Update status to merge-review
      await this.assignmentManager.updateStatusWithSync(assignment.id, 'merge-review');

      // Set assigned instance to merge worker
      await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, 'merge-worker');

      // Step 1: Merge the branch
      console.log(chalk.blue('📦 Step 1: Merging branch...'));
      const mergeResult = await this.branchManager.mergeFeatureBranch(
        assignment.branchName,
        assignment.issueNumber
      );

      if (!mergeResult.success) {
        if (mergeResult.hasConflicts && mergeResult.conflictFiles) {
          // Step 2: Resolve conflicts
          if (this.config.autoResolveConflicts) {
            console.log(chalk.yellow(`  ⚠️  Conflicts detected in ${mergeResult.conflictFiles.length} file(s)`));
            console.log(chalk.blue('\n🔧 Step 2: Resolving conflicts automatically...'));

            const resolutionResult = await this.conflictResolver.resolveConflicts(
              mergeResult.conflictFiles,
              {
                branchName: assignment.branchName,
                issueNumber: assignment.issueNumber,
                issueTitle: assignment.issueTitle,
              }
            );

            if (!resolutionResult.success) {
              await this.rejectItem(assignment, `Failed to resolve conflicts: ${resolutionResult.error}`);
              return;
            }

            // Commit the resolved conflicts
            const commitSha = await this.branchManager.commitResolvedConflicts(
              `Merge ${assignment.branchName} (issue #${assignment.issueNumber}) - conflicts resolved`
            );
            console.log(chalk.green(`  ✓ Conflicts resolved and committed: ${commitSha.substring(0, 7)}`));
          } else {
            // Manual conflict resolution required
            await this.rejectItem(
              assignment,
              `Merge conflicts detected in: ${mergeResult.conflictFiles.join(', ')}. Manual resolution required.`
            );
            await this.branchManager.abortMerge();
            return;
          }
        } else {
          // Other merge error
          await this.rejectItem(assignment, `Merge failed: ${mergeResult.error}`);
          return;
        }
      } else {
        console.log(chalk.green(`  ✓ Branch merged successfully: ${mergeResult.commitSha?.substring(0, 7)}`));
      }

      // Step 3: Get diff for review
      console.log(chalk.blue('\n📊 Step 3: Preparing for review...'));
      const diff = await this.branchManager.getDiffWithMain();

      // Step 4: Multi-persona review
      console.log(chalk.blue('\n🔍 Step 4: Multi-persona review...'));
      const reviewResult = await this.personaReviewer.reviewChanges(assignment, {
        worktreePath: assignment.worktreePath,
        branchName: assignment.branchName,
        diff,
      });

      // Store review results
      await this.assignmentManager.updateAssignment(assignment.id, {
        reviewResults: {
          startedAt: reviewResult.personaReviews[0]?.reviewedAt || new Date().toISOString(),
          completedAt: new Date().toISOString(),
          personaReviews: reviewResult.personaReviews,
          overallPassed: reviewResult.overallPassed,
          failureReasons: reviewResult.failureReasons,
        },
      } as any);

      if (reviewResult.overallPassed) {
        // Step 5: Force push to stage
        console.log(chalk.blue('\n🚀 Step 5: Pushing to stage...'));
        const stageSha = await this.branchManager.forcePushToStage();

        // Update assignment
        await this.assignmentManager.updateAssignment(assignment.id, {
          mergeStageCommit: stageSha,
        } as any);

        // Step 6 (Optional): Auto-merge to main if enabled
        if (this.config.autoMergeToMain) {
          console.log(chalk.blue('\n🎯 Step 6: Auto-merging stage to main...'));

          const mainMergeResult = await this.branchManager.mergeStageToMain();

          if (!mainMergeResult.success) {
            if (mainMergeResult.hasConflicts && mainMergeResult.conflictFiles) {
              // Conflicts with main - resolve them
              console.log(chalk.yellow(`  ⚠️  Conflicts detected with main in ${mainMergeResult.conflictFiles.length} file(s)`));
              console.log(chalk.blue('\n🔧 Step 7: Resolving main merge conflicts...'));

              const resolutionResult = await this.conflictResolver.resolveConflicts(
                mainMergeResult.conflictFiles,
                {
                  branchName: assignment.branchName,
                  issueNumber: assignment.issueNumber,
                  issueTitle: assignment.issueTitle,
                }
              );

              if (!resolutionResult.success) {
                // Failed to resolve conflicts with main - mark as stage-ready for manual review
                await this.assignmentManager.updateStatusWithSync(assignment.id, 'stage-ready');
                await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);

                // Epic mode: Sync all phase items to stage-ready
                await this.syncPhaseItemStatuses(assignment, 'stage-ready');

                this.logEvent('⚠️', `Approved but main conflicts: #${assignment.issueNumber}`, assignment.issueTitle || '');
                console.log(chalk.yellow(`\n⚠️  Issue #${assignment.issueNumber} on stage, but failed to auto-merge to main due to conflicts`));
                return;
              }

              // Commit resolved conflicts and push
              await this.branchManager.commitResolvedConflicts(
                `Merge stage to main (issue #${assignment.issueNumber}) - conflicts resolved`
              );

              // Push to main
              await this.branchManager.mergeStageToMain();
            } else {
              // Other error - mark as stage-ready for manual intervention
              await this.assignmentManager.updateStatusWithSync(assignment.id, 'stage-ready');
              await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);

              // Epic mode: Sync all phase items to stage-ready
              await this.syncPhaseItemStatuses(assignment, 'stage-ready');

              this.logEvent('⚠️', `Approved but main merge failed: #${assignment.issueNumber}`, mainMergeResult.error || '');
              console.log(chalk.yellow(`\n⚠️  Issue #${assignment.issueNumber} on stage, but failed to auto-merge to main: ${mainMergeResult.error}`));
              return;
            }
          }

          // Main merge successful - mark as merged
          await this.assignmentManager.updateAssignment(assignment.id, {
            mergeMainCommit: mainMergeResult.commitSha,
          } as any);
          await this.assignmentManager.updateStatusWithSync(assignment.id, 'merged');

          // Clear assigned instance - completely finished
          await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);

          // Epic mode: Sync all phase items to merged
          await this.syncPhaseItemStatuses(assignment, 'merged');

          this.logEvent('✅', `Completed: #${assignment.issueNumber} → main`, assignment.issueTitle || '');
          if (this.verbose) {
            console.log(chalk.green.bold(`\n✅ Issue #${assignment.issueNumber} complete and merged to main!`));
          }
        } else {
          // No auto-merge - mark as stage-ready for manual approval
          await this.assignmentManager.updateStatusWithSync(assignment.id, 'stage-ready');

          // Clear assigned instance - work is complete and on stage
          await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);

          // Epic mode: Sync all phase items to stage-ready
          await this.syncPhaseItemStatuses(assignment, 'stage-ready');

          this.logEvent('✅', `Approved: #${assignment.issueNumber} → stage`, assignment.issueTitle || '');
          if (this.verbose) {
            console.log(chalk.green.bold(`\n✅ Issue #${assignment.issueNumber} approved and pushed to stage!`));
          }
        }
      } else {
        // Review failed - send back to Todo with feedback
        await this.rejectItemWithReview(assignment, reviewResult);
      }
    } catch (error) {
      console.error(chalk.red(`\n✗ Error processing issue #${assignment.issueNumber}:`), error);
      await this.rejectItem(
        assignment,
        `Internal error during merge processing: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Reject an item and send back for re-evaluation or Todo
   */
  private async rejectItem(assignment: Assignment, reason: string): Promise<void> {
    this.logEvent('❌', `Rejected: #${assignment.issueNumber}`, reason);
    if (this.verbose) {
      console.log(chalk.red.bold(`\n❌ Issue #${assignment.issueNumber} rejected`));
      console.log(chalk.yellow(`  Reason: ${reason}\n`));
    }

    // Set status to Evaluate (if configured) or back to Todo
    const nextStatus = this.config.evaluateValue || 'Todo';
    if (this.config.evaluateValue && this.projectsAPI && assignment.projectItemId) {
      // Use projectsAPI to set custom "Evaluate" status
      await this.projectsAPI.updateItemStatusByValue(assignment.projectItemId, this.config.evaluateValue);
      console.log(chalk.gray(`  ✓ Status set to "${this.config.evaluateValue}" for re-evaluation`));
    } else {
      // Fall back to standard "assigned" (Todo) status
      await this.assignmentManager.updateStatusWithSync(assignment.id, 'assigned');
    }

    // Clear assigned instance - item needs to be reassigned
    await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);

    // Add comment to GitHub issue with feedback
    if (this.githubAPI) {
      const comment = `## ❌ Merge Worker: Review Failed

**Reason:**
${reason}

**Next Steps:**
This issue has been sent back to ${nextStatus}. Please address the issues above and the system will process it again.

---
*Automated by Merge Worker*`;

      try {
        await this.githubAPI.createComment(assignment.issueNumber, comment);
      } catch (error) {
        console.error(chalk.yellow('  ⚠️  Could not add comment to GitHub issue'));
      }
    }
  }

  /**
   * Reject an item with detailed review feedback
   */
  private async rejectItemWithReview(assignment: Assignment, reviewResult: ReviewResult): Promise<void> {
    console.log(chalk.red.bold(`\n❌ Issue #${assignment.issueNumber} failed review`));

    const failedReviews = reviewResult.personaReviews.filter(r => !r.passed);
    console.log(chalk.yellow(`  Failed ${failedReviews.length} of ${reviewResult.personaReviews.length} persona reviews\n`));

    // Build detailed feedback
    const feedbackSections = failedReviews.map(review => {
      return `### ${review.persona.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
${review.feedback}`;
    }).join('\n\n');

    // Set status to Evaluate (if configured) or back to Todo
    const nextStatus = this.config.evaluateValue || 'Todo';
    const fullFeedback = `## ❌ Merge Worker: Review Failed

The code changes did not pass all persona reviews. Please address the issues below:

${feedbackSections}

---

**Review Summary:**
- Passed: ${reviewResult.personaReviews.filter(r => r.passed).length}/${reviewResult.personaReviews.length}
- Status: ${reviewResult.overallPassed ? 'PASSED' : 'FAILED'}

**Next Steps:**
This issue has been sent back to ${nextStatus}. Address the feedback above and the system will process it again for another attempt.

---
*Automated by Merge Worker*`;

    // Set status to Evaluate (if configured) or back to Todo
    if (this.config.evaluateValue && this.projectsAPI && assignment.projectItemId) {
      // Use projectsAPI to set custom "Evaluate" status
      await this.projectsAPI.updateItemStatusByValue(assignment.projectItemId, this.config.evaluateValue);
      console.log(chalk.gray(`  ✓ Status set to "${this.config.evaluateValue}" for re-evaluation`));
    } else {
      // Fall back to standard "assigned" (Todo) status
      await this.assignmentManager.updateStatusWithSync(assignment.id, 'assigned');
    }

    // Clear assigned instance - item needs to be reassigned
    await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);

    // Add detailed comment to GitHub issue
    if (this.githubAPI) {
      try {
        await this.githubAPI.createComment(assignment.issueNumber, fullFeedback);
        console.log(chalk.gray('  ✓ Detailed feedback posted to GitHub issue'));
      } catch (error) {
        console.error(chalk.yellow('  ⚠️  Could not add comment to GitHub issue'));
      }
    }
  }

  /**
   * Check if worker is currently running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}