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
import { ProjectItemMetadata, PrioritizationContext } from '../types/project.js';
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
    projectMetadata: ProjectItemMetadata | null
  ): PrioritizationContext {
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

    // Sprint boost (0 or 10)
    const sprintScore = projectMetadata && this.fieldMapper.isInCurrentSprint(projectMetadata.sprint)
      ? 10
      : 0;

    // Size preference (0-10)
    const sizeScore = projectMetadata
      ? this.fieldMapper.getSizePreferenceScore(projectMetadata.size)
      : 5; // Default neutral

    // Calculate weighted hybrid score
    const hybridScore =
      aiScore * weights.aiEvaluation +
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
    projectMetadataMap: Map<number, ProjectItemMetadata>
  ): PrioritizedIssue[] {
    const prioritized: PrioritizedIssue[] = evaluations.map((evaluation) => {
      const projectMetadata = projectMetadataMap.get(evaluation.issueNumber) || null;
      const context = this.calculatePriority(evaluation, projectMetadata);

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
