/**
 * Epic Orchestrator - Manages phased epic development
 *
 * Handles:
 * - Filtering items by epic
 * - Grouping items by phase
 * - Phase completion detection
 * - Master item management
 * - Merge status tracking
 */

import { Octokit } from '@octokit/rest';
import chalk from 'chalk';
import {
  ProjectItemWithMetadata,
  EpicPhase,
  EpicOrchestratorConfig,
} from '../types/project.js';

export class EpicOrchestrator {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private config: EpicOrchestratorConfig;

  constructor(
    octokit: Octokit,
    owner: string,
    repo: string,
    config: EpicOrchestratorConfig
  ) {
    this.octokit = octokit;
    this.owner = owner;
    this.repo = repo;
    this.config = config;
  }

  /**
   * Filter items belonging to the configured epic
   */
  filterEpicItems(allItems: ProjectItemWithMetadata[]): ProjectItemWithMetadata[] {
    return allItems.filter(item => {
      // Match by epic field
      if (item.metadata.epic === this.config.epicName) {
        return true;
      }

      // Fallback: match by title containing epic name
      if (item.issueTitle.toLowerCase().includes(this.config.epicName.toLowerCase())) {
        return true;
      }

      return false;
    });
  }

  /**
   * Check if an item is a phase master ticket
   * Uses Type field first, falls back to title pattern detection
   */
  private isPhaseMaster(item: ProjectItemWithMetadata): boolean {
    // Phase master detection:
    // - Title contains "MASTER" keyword (required)
    // - Title contains "Phase N" where N is an integer (NOT decimal like Phase 7.2)
    //
    // Examples that match (masters):
    // - "[Epic Name] Phase 1: Phase Name - MASTER"
    // - "Phase 2: Technical Feasibility - MASTER"
    // - "[Epic] Phase 3 - Infrastructure MASTER"
    //
    // Examples that don't match (work items):
    // - "[Epic] (Phase 1.1) Implement API endpoints" (decimal phase = work item)
    // - "Phase 2: Add logging" (no MASTER keyword)
    // - "[Epic] (Phase 7.2) Work item title" (decimal in parentheses)

    const title = item.issueTitle;

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
   * Group items by phase, sorted by phase number
   */
  async groupItemsByPhase(items: ProjectItemWithMetadata[]): Promise<Map<string, EpicPhase>> {
    const phaseMap = new Map<string, EpicPhase>();

    console.log(chalk.blue(`\n🔍 DEBUG: Grouping ${items.length} items by phase...`));

    for (const item of items) {
      // Extract phase from metadata or title
      let phase = item.metadata.phase;

      // Fallback: detect phase from title (e.g., "Phase 1:", "[Phase 2]")
      if (!phase) {
        const phaseMatch = item.issueTitle.match(/\b[Pp]hase\s+(\d+)\b/);
        if (phaseMatch) {
          phase = `Phase ${phaseMatch[1]}`;
        }
      }

      if (!phase) {
        phase = 'Phase 0'; // Default phase for items without explicit phase
      }

      if (!phaseMap.has(phase)) {
        phaseMap.set(phase, {
          phaseName: phase,
          masterItem: null,
          workItems: [],
          isComplete: false,
          allItemsMerged: false,
        });
      }

      const phaseData = phaseMap.get(phase)!;

      // Check if this is a master item
      // Primary: Type field set to "Epic"
      // Fallback: Title pattern matching phase master conventions
      const isMaster = this.isPhaseMaster(item);

      console.log(chalk.gray(`  #${item.issueNumber}: "${item.issueTitle.substring(0, 60)}..." → ${phase} ${isMaster ? '[MASTER]' : '[WORK]'}`));

      if (isMaster) {
        phaseData.masterItem = item;
      } else {
        phaseData.workItems.push(item);
      }
    }

    // Check completion status for each phase
    for (const phase of phaseMap.values()) {
      phase.isComplete = await this.checkPhaseComplete(phase);
      phase.allItemsMerged = await this.checkAllItemsMerged(phase.workItems);
    }

    return phaseMap;
  }

  /**
   * Get the current (lowest incomplete) phase
   */
  getCurrentPhase(phases: Map<string, EpicPhase>): EpicPhase | null {
    // Sort phases by number
    const sortedPhases = Array.from(phases.values()).sort((a, b) => {
      const numA = parseInt(a.phaseName.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.phaseName.replace(/\D/g, '')) || 0;
      return numA - numB;
    });

    console.log(chalk.blue('\n🔍 DEBUG: Phase Status'));
    for (const phase of sortedPhases) {
      console.log(chalk.gray(`  ${phase.phaseName}: ${phase.isComplete ? '✅ Complete' : '❌ Incomplete'} (${phase.workItems.length} work items, ${phase.masterItem ? '1 master' : 'no master'})`));
    }

    // Find first incomplete phase
    for (const phase of sortedPhases) {
      if (!phase.isComplete) {
        console.log(chalk.yellow(`  → Current phase: ${phase.phaseName}`));
        return phase;
      }
    }

    return null; // All phases complete
  }

  /**
   * Check if a phase is complete (all items done and merged)
   */
  private async checkPhaseComplete(phase: EpicPhase): Promise<boolean> {
    // Phase is complete if:
    // 1. Phase has work items (empty phases are NOT complete)
    // 2. All work items have status "Done" or "Completed" or "Dev Complete"
    // 3. All work items are merged to main

    // Empty phase is never complete - must have work items
    if (phase.workItems.length === 0) {
      return false;
    }

    for (const item of phase.workItems) {
      const status = item.metadata.status?.toLowerCase();
      if (status !== 'done' && status !== 'completed' && status !== 'dev-complete') {
        return false;
      }
    }

    // Check if all items are merged
    return await this.checkAllItemsMerged(phase.workItems);
  }

  /**
   * Check if all items in a list are merged to main
   */
  private async checkAllItemsMerged(items: ProjectItemWithMetadata[]): Promise<boolean> {
    for (const item of items) {
      const isMerged = await this.checkItemMergedToMain(item.issueNumber);
      if (!isMerged) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if a specific issue's PR is merged to main
   */
  async checkItemMergedToMain(issueNumber: number): Promise<boolean> {
    try {
      // Get PRs associated with this issue
      const { data: issue } = await this.octokit.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });

      // Check if issue is closed
      if (issue.state !== 'closed') {
        return false;
      }

      // Look for associated PR
      const timelineQuery = `
        query($owner: String!, $repo: String!, $issueNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            issue(number: $issueNumber) {
              timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT]) {
                nodes {
                  ... on CrossReferencedEvent {
                    source {
                      ... on PullRequest {
                        number
                        merged
                        mergedAt
                        baseRefName
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const result: any = await this.octokit.graphql(timelineQuery, {
        owner: this.owner,
        repo: this.repo,
        issueNumber,
      });

      // Check if any linked PR is merged to main
      const timelineItems = result.repository.issue.timelineItems.nodes;
      for (const item of timelineItems) {
        if (item.source && item.source.merged && item.source.baseRefName === 'main') {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.warn(chalk.yellow(`  Warning: Could not check merge status for issue #${issueNumber}`));
      return false;
    }
  }

  /**
   * Get assignable items for current phase (excludes master items)
   */
  getAssignableItems(phase: EpicPhase): ProjectItemWithMetadata[] {
    // Phase master is assignable only if all work items are complete
    const allWorkComplete = phase.workItems.every(item => {
      const status = item.metadata.status?.toLowerCase();
      return status === 'done' || status === 'completed' || status === 'dev-complete';
    });

    if (allWorkComplete && phase.masterItem) {
      // Work complete - only master is assignable
      return [phase.masterItem];
    } else {
      // Work not complete - only work items are assignable
      return phase.workItems;
    }
  }

  /**
   * Get all assignable items from the epic, respecting phase sequencing
   * 
   * Phase Assignment Rules:
   * 1. Only one phase can be active at a time (sequential execution)
   * 2. Phase work items must complete before phase master is assignable
   * 3. Phase master must complete before next phase work items are assignable
   * 
   * Flow: Phase N work → Phase N master → Phase N+1 work → Phase N+1 master → ...
   */
  async getAssignableItemsForEpic(
    allEpicItems: ProjectItemWithMetadata[],
    assignmentManager: any
  ): Promise<ProjectItemWithMetadata[]> {
    // Group items by phase
    const phases = await this.groupItemsByPhase(allEpicItems);
    
    // Get current (first incomplete) phase
    const currentPhase = this.getCurrentPhase(phases);
    
    if (!currentPhase) {
      console.log(chalk.green(`  ✓ All phases complete!`));
      return [];
    }

    console.log(chalk.blue(`  📍 Current Phase: ${currentPhase.phaseName}`));
    
    // Check if phase master is currently assigned
    if (currentPhase.masterItem) {
      const masterAssigned = assignmentManager.getAssignmentByIssue(
        currentPhase.masterItem.issueNumber
      );

      if (masterAssigned) {
        console.log(chalk.yellow(`  ⚠️  Phase master #${currentPhase.masterItem.issueNumber} is assigned - blocking subsequent phases`));
        return [];
      }
    }
    
    // Get assignable items from current phase
    const assignableItems = this.getAssignableItems(currentPhase);

    console.log(chalk.gray(`  Assignable from phase: ${assignableItems.length} item(s)`));
    assignableItems.forEach(item => {
      const isMaster = item === currentPhase.masterItem;
      console.log(chalk.gray(`    - #${item.issueNumber}: ${item.issueTitle}${isMaster ? ' [MASTER]' : ''}`));
    });

    return assignableItems;
  }

  /**
   * Update current phase in config
   */
  updateCurrentPhase(phaseName: string): void {
    this.config.currentPhase = phaseName;
  }

  /**
   * Get epic configuration
   */
  getConfig(): EpicOrchestratorConfig {
    return this.config;
  }

  /**
   * Log phase status
   */
  logPhaseStatus(phases: Map<string, EpicPhase>): void {
    console.log(chalk.blue(`\n📊 Epic: ${this.config.epicName}`));

    for (const [phaseName, phase] of phases) {
      const status = phase.isComplete ? '✅ Complete' : '🔄 In Progress';
      const itemCount = phase.workItems.length;
      const mergedCount = phase.workItems.filter(item =>
        item.metadata.status?.toLowerCase() === 'done'
      ).length;

      console.log(chalk.gray(`  ${phaseName}: ${status} (${mergedCount}/${itemCount} items complete)`));

      if (phase.masterItem) {
        console.log(chalk.gray(`    Master: #${phase.masterItem.issueNumber} ${phase.masterItem.issueTitle}`));
      }
    }
  }
}
