/**
 * Project-Aware Prioritizer
 *
 * Implements hybrid prioritization combining:
 * - AI evaluation scores (30%)
 * - Project Priority field (50%)
 * - Sprint assignment (10%)
 * - Size preference (10%)
 */

import { IssueEvaluation } from '../types/evaluation.js';
import { ProjectItemMetadata, PrioritizationContext, SprintFieldValue, DependencyScore } from '../types/project.js';
import { ProjectConfig } from '../types/config.js';
import { ProjectFieldMapper } from '../github/project-field-mapper.js';

export interface PrioritizedIssue {
  issueNumber: number;
  issueTitle: string;
  hybridScore: number;
  context: PrioritizationContext;
}

export class ProjectAwarePrioritizer {
  private config: ProjectConfig;
  private fieldMapper: ProjectFieldMapper;

  constructor(config: ProjectConfig, fieldMapper: ProjectFieldMapper) {
    this.config = config;
    this.fieldMapper = fieldMapper;
  }

  /**
   * Calculate hybrid priority score for a single issue
   */
  calculatePriority(
    evaluation: IssueEvaluation,
    projectMetadata: ProjectItemMetadata | null,
    dependencyScore?: DependencyScore | null
  ): PrioritizationContext {
    // Support both old and new weight configurations
    const weights = this.config.prioritization?.weights || {
      projectPriority: 0.5,
      aiEvaluation: 0.3,
      sprintBoost: 0.1,
      sizePreference: 0.1,
    };

    // AI evaluation score (0-10)
    const aiScore = evaluation.scores.aiPriorityScore;

    // Project priority weight (0-10)
    const projectPriorityScore = projectMetadata
      ? this.fieldMapper.getPriorityWeight(projectMetadata.priority)
      : 0;

    // Sprint boost (0-15, with urgency multiplier)
    const sprintScore = this.calculateSprintScore(projectMetadata?.sprint || null);

    // Size preference (0-10)
    const sizeScore = projectMetadata
      ? this.fieldMapper.getSizePreferenceScore(projectMetadata.size)
      : 5; // Default neutral

    // Dependency score (0-10, based on blocking/blocked status)
    const depScore = dependencyScore ? this.calculateDependencyPriorityScore(dependencyScore) : 5;

    // Get dependency weight (default 0 for backwards compatibility)
    const depWeight = (weights as any).dependencyScore || 0;

    // Calculate weighted hybrid score
    // If dependency weight is provided, rebalance other weights
    const hasDepWeight = depWeight > 0;
    const totalWeight = hasDepWeight
      ? weights.aiEvaluation + weights.projectPriority + weights.sprintBoost + weights.sizePreference + depWeight
      : weights.aiEvaluation + weights.projectPriority + weights.sprintBoost + weights.sizePreference;

    const hybridScore = hasDepWeight
      ? (aiScore * weights.aiEvaluation +
         projectPriorityScore * weights.projectPriority +
         sprintScore * weights.sprintBoost +
         sizeScore * weights.sizePreference +
         depScore * depWeight) / totalWeight * 10
      : aiScore * weights.aiEvaluation +
        projectPriorityScore * weights.projectPriority +
        sprintScore * weights.sprintBoost +
        sizeScore * weights.sizePreference;

    return {
      issueNumber: evaluation.issueNumber,
      issueTitle: evaluation.issueTitle,
      aiPriorityScore: evaluation.scores.aiPriorityScore,
      complexity: evaluation.classification.complexity,
      impact: evaluation.classification.impact,
      clarity: evaluation.scores.clarity,
      importance: evaluation.scores.importance,
      feasibility: evaluation.scores.feasibility,
      projectPriority: projectMetadata?.priority || null,
      projectSize: projectMetadata?.size || null,
      projectSprint: projectMetadata?.sprint || null,
      projectStatus: projectMetadata?.status || null,
      hybridScore,
    };
  }

  /**
   * Prioritize a list of issues using hybrid scoring
   */
  prioritizeIssues(
    evaluations: IssueEvaluation[],
    projectMetadataMap: Map<number, ProjectItemMetadata>,
    dependencyScores?: Map<number, DependencyScore>
  ): PrioritizedIssue[] {
    const prioritized: PrioritizedIssue[] = evaluations.map((evaluation) => {
      const projectMetadata = projectMetadataMap.get(evaluation.issueNumber) || null;
      const dependencyScore = dependencyScores?.get(evaluation.issueNumber) || null;
      const context = this.calculatePriority(evaluation, projectMetadata, dependencyScore);

      return {
        issueNumber: evaluation.issueNumber,
        issueTitle: evaluation.issueTitle,
        hybridScore: context.hybridScore,
        context,
      };
    });

    // Sort by hybrid score (highest first)
    prioritized.sort((a, b) => b.hybridScore - a.hybridScore);

    return prioritized;
  }

  /**
   * Get prioritization breakdown for debugging
   */
  getPrioritizationBreakdown(context: PrioritizationContext): string {
    const weights = this.config.prioritization?.weights || {
      projectPriority: 0.5,
      aiEvaluation: 0.3,
      sprintBoost: 0.1,
      sizePreference: 0.1,
    };

    const aiScore = context.aiPriorityScore;
    const projectPriorityScore = this.fieldMapper.getPriorityWeight(context.projectPriority);
    const sprintScore = this.fieldMapper.isInCurrentSprint(context.projectSprint) ? 10 : 0;
    const sizeScore = this.fieldMapper.getSizePreferenceScore(context.projectSize);

    const lines = [
      `Issue #${context.issueNumber}: ${context.issueTitle}`,
      ``,
      `Hybrid Score: ${context.hybridScore.toFixed(2)}`,
      ``,
      `Breakdown:`,
      `  AI Evaluation:    ${aiScore.toFixed(1)}/10 × ${weights.aiEvaluation} = ${(aiScore * weights.aiEvaluation).toFixed(2)}`,
      `    - Clarity:      ${context.clarity.toFixed(1)}/10`,
      `    - Importance:   ${context.importance.toFixed(1)}/10`,
      `    - Feasibility:  ${context.feasibility.toFixed(1)}/10`,
      `    - Complexity:   ${context.complexity}`,
      `    - Impact:       ${context.impact}`,
      ``,
      `  Project Priority: ${projectPriorityScore.toFixed(1)}/10 × ${weights.projectPriority} = ${(projectPriorityScore * weights.projectPriority).toFixed(2)}`,
      `    - Value:        ${context.projectPriority || 'Not set'}`,
      ``,
      `  Sprint Boost:     ${sprintScore.toFixed(1)}/10 × ${weights.sprintBoost} = ${(sprintScore * weights.sprintBoost).toFixed(2)}`,
      `    - Sprint:       ${context.projectSprint?.title || 'Not assigned'}`,
      ``,
      `  Size Preference:  ${sizeScore.toFixed(1)}/10 × ${weights.sizePreference} = ${(sizeScore * weights.sizePreference).toFixed(2)}`,
      `    - Size:         ${context.projectSize || 'Not set'}`,
    ];

    return lines.join('\n');
  }

  /**
   * Calculate sprint score with urgency multiplier
   * Returns 0-20 based on current sprint and days remaining
   */
  private calculateSprintScore(sprint: SprintFieldValue | null): number {
    if (!sprint) {
      return 0; // Not in any sprint
    }

    // Check if in current sprint
    const isInCurrentSprint = this.fieldMapper.isInCurrentSprint(sprint);

    if (!isInCurrentSprint) {
      // Check if in an upcoming sprint (lower priority)
      const metadata = this.fieldMapper.getSprintMetadata(sprint);
      if (metadata.isUpcoming) {
        return 3; // Upcoming sprint items get some boost
      }
      return 0; // Past or no sprint
    }

    // In current sprint - calculate urgency multiplier
    const metadata = this.fieldMapper.getSprintMetadata(sprint);
    const daysRemaining = metadata.daysRemaining || metadata.duration;

    // More urgent as sprint end approaches
    // 10+ days remaining: 10 points
    // 5-10 days: 11 points
    // 1-5 days: 13 points
    // Today or overdue: 15 points (extra boost)
    if (daysRemaining <= 0) {
      return 15; // Overdue - very urgent!
    } else if (daysRemaining <= 1) {
      return 14; // Due today/tomorrow - urgent
    } else if (daysRemaining <= 5) {
      return 13; // Due this week - high priority
    } else if (daysRemaining <= 10) {
      return 11; // Due soon - elevated priority
    } else {
      return 10; // In current sprint - normal boost
    }
  }

  /**
   * Calculate dependency priority score
   * Returns 0-10 based on blocking/blocked status
   */
  private calculateDependencyPriorityScore(depScore: DependencyScore): number {
    // Start with base score of 5 (neutral)
    let score = 5;

    // Penalize blocked issues
    if (depScore.isBlocked) {
      // More penalties for more blockers
      if (depScore.blockedByCount >= 3) {
        score -= 5; // Heavily blocked = 0
      } else if (depScore.blockedByCount === 2) {
        score -= 3; // Moderately blocked = 2
      } else {
        score -= 2; // Lightly blocked = 3
      }
    }

    // Reward unblocking high-impact issues
    if (depScore.blockingScore > 0) {
      // The more issues this unblocks, the higher the score
      if (depScore.blockingScore >= 5) {
        score += 5; // Unblocks many = 10
      } else if (depScore.blockingScore >= 3) {
        score += 3; // Unblocks several = 8
      } else {
        score += 1; // Unblocks some = 6
      }
    }

    // Bonus for leaf nodes (doesn't block anything, easy to complete independently)
    if (depScore.isLeaf && !depScore.isBlocked) {
      score += 2; // Independent leaf = +2
    }

    // Normalize to 0-10 range
    return Math.max(0, Math.min(10, score));
  }

  /**
   * Filter issues by status (only include "ready" items)
   */
  filterReadyIssues(
    prioritizedIssues: PrioritizedIssue[],
    projectMetadataMap: Map<number, ProjectItemMetadata>
  ): PrioritizedIssue[] {
    const readyStatuses = this.config.fields.status.readyValues;

    return prioritizedIssues.filter((issue) => {
      const metadata = projectMetadataMap.get(issue.issueNumber);
      if (!metadata || !metadata.status) {
        return false; // No metadata or status = not ready
      }
      return readyStatuses.includes(metadata.status);
    });
  }

  /**
   * Filter issues that are blocked
   */
  filterBlockedIssues(
    prioritizedIssues: PrioritizedIssue[],
    projectMetadataMap: Map<number, ProjectItemMetadata>
  ): PrioritizedIssue[] {
    const blockedStatus = this.config.fields.status.blockedValue;

    return prioritizedIssues.filter((issue) => {
      const metadata = projectMetadataMap.get(issue.issueNumber);
      if (!metadata || !metadata.status) {
        return false;
      }
      return metadata.status === blockedStatus || metadata.blockedBy;
    });
  }
}
