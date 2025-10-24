/**
 * Issue Evaluator - Intelligently evaluates and prioritizes GitHub issues
 *
 * SYNC STRATEGY:
 * - Caches AI-generated insights (complexity, impact, clarity, importance, feasibility, aiPriorityScore)
 * - Does NOT cache project fields (Priority, Area, Issue Type, Size) - those should be read fresh
 * - Re-evaluates when issue updatedAt > lastEvaluated
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { $ } from 'zx';
import chalk from 'chalk';
import {
  IssueEvaluation,
  EvaluationCache,
  EvaluationPromptContext,
  IssueScores,
} from '../types/index.js';
import { buildEvaluationPrompt } from '../llm/evaluation-prompt.js';
import { Issue } from '../types/github.js';
import { GitHubAPI } from '../github/api.js';
import { IssueRelationshipParser } from '../utils/issue-relationship-parser.js';

export class IssueEvaluator {
  private cachePath: string;
  private cache: EvaluationCache | null = null;
  private claudePath: string;
  private githubAPI: GitHubAPI | null = null;

  constructor(projectPath: string, claudePath: string = 'claude', githubAPI?: GitHubAPI) {
    this.cachePath = join(projectPath, '.autonomous', 'issue-evaluations.json');
    this.claudePath = claudePath;
    this.githubAPI = githubAPI || null;
  }

  /**
   * Load evaluation cache from disk
   */
  async loadCache(): Promise<void> {
    try {
      const data = await fs.readFile(this.cachePath, 'utf-8');
      this.cache = JSON.parse(data);
    } catch (error) {
      // Cache doesn't exist yet, initialize empty
      this.cache = {
        version: '1.0.0',
        projectName: '',
        lastUpdated: new Date().toISOString(),
        evaluations: {},
      };
    }
  }

  /**
   * Save evaluation cache to disk
   */
  async saveCache(): Promise<void> {
    if (!this.cache) {
      throw new Error('Cache not initialized');
    }

    this.cache.lastUpdated = new Date().toISOString();
    await fs.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  /**
   * Evaluate and prioritize a list of issues
   * Returns issues sorted by priority (highest first)
   */
  async evaluateIssues(
    issues: Issue[],
    options: { forceReeval?: boolean; verbose?: boolean } = {}
  ): Promise<{ evaluated: IssueEvaluation[]; skipped: Issue[] }> {
    if (!this.cache) {
      await this.loadCache();
    }

    const { forceReeval = false, verbose = false } = options;
    const evaluated: IssueEvaluation[] = [];
    const skipped: Issue[] = [];

    console.log(chalk.blue(`\n🔍 Evaluating ${issues.length} issue(s)...\n`));

    for (const issue of issues) {
      // Check if we need to re-evaluate
      const cachedEval = this.cache!.evaluations[issue.number];
      const needsEval =
        forceReeval ||
        !cachedEval ||
        new Date(issue.updatedAt) > new Date(cachedEval.lastModified);

      if (needsEval) {
        if (verbose) {
          console.log(chalk.gray(`Evaluating issue #${issue.number}: ${issue.title}`));
        }

        try {
          const evaluation = await this.evaluateIssue(issue);

          // Save to cache
          this.cache!.evaluations[issue.number] = evaluation;

          if (evaluation.hasEnoughDetail) {
            evaluated.push(evaluation);
            if (verbose) {
              console.log(
                chalk.green(
                  `  ✓ AI Priority: ${evaluation.scores.aiPriorityScore.toFixed(1)} | ${evaluation.classification.complexity} complexity | ${evaluation.estimatedEffort}`
                )
              );
            }
          } else {
            skipped.push(issue);
            if (verbose) {
              console.log(chalk.yellow(`  ⚠️  Insufficient detail - needs clarification`));
              if (evaluation.suggestedQuestions && evaluation.suggestedQuestions.length > 0) {
                console.log(
                  chalk.gray(
                    `     Questions: ${evaluation.suggestedQuestions.slice(0, 2).join('; ')}`
                  )
                );
              }
            }
          }
        } catch (error: any) {
          console.warn(
            chalk.yellow(`  ⚠️  Failed to evaluate issue #${issue.number}: ${error.message}`)
          );
          skipped.push(issue);
        }

        // Small delay to avoid rate limiting
        await this.sleep(500);
      } else {
        // Use cached evaluation
        if (cachedEval.hasEnoughDetail) {
          evaluated.push(cachedEval);
          if (verbose) {
            console.log(
              chalk.gray(
                `✓ Using cached evaluation for #${issue.number} (AI priority: ${cachedEval.scores.aiPriorityScore.toFixed(1)})`
              )
            );
          }
        } else {
          skipped.push(issue);
        }
      }
    }

    // Save cache
    await this.saveCache();

    // Sort by AI priority score (highest first)
    // NOTE: In Phase 1+, hybrid prioritization will combine this with project Priority
    evaluated.sort((a, b) => b.scores.aiPriorityScore - a.scores.aiPriorityScore);

    console.log(chalk.green(`\n✓ Evaluation complete:`));
    console.log(`  ${chalk.bold(evaluated.length)} issues ready for assignment`);
    console.log(`  ${chalk.yellow(skipped.length)} issues need more detail\n`);

    return { evaluated, skipped };
  }

  /**
   * Evaluate a single issue using Claude
   */
  private async evaluateIssue(issue: Issue): Promise<IssueEvaluation> {
    // Build base context
    const context: EvaluationPromptContext = {
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body,
      labels: issue.labels.map((l: any) => l.name),
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      author: issue.user.login,
      comments: 0, // We could fetch this if needed
    };

    // Add relationship context if GitHubAPI is available
    if (this.githubAPI && issue.relationships && issue.relationships.length > 0) {
      // Parse relationship structure
      const parsed = IssueRelationshipParser.parse(issue.body, issue.number);
      context.isLikelyParent = IssueRelationshipParser.isLikelyParent(issue.body, issue.title);
      context.isLikelyLeaf = IssueRelationshipParser.isLikelyLeaf(parsed);

      // Fetch parent issue if exists
      if (issue.parentIssue) {
        try {
          const parent = await this.githubAPI.getIssue(issue.parentIssue);
          const parentRel = issue.relationships.find((r) => r.issueNumber === issue.parentIssue);
          context.parentIssue = {
            number: parent.number,
            title: parent.title,
            state: parent.state,
            relationshipType: parentRel?.type || 'parent',
            body: parent.body,
          };
        } catch (error) {
          console.warn(`Could not fetch parent issue #${issue.parentIssue}`);
        }
      }

      // Fetch child issues
      if (issue.childIssues && issue.childIssues.length > 0) {
        context.childIssues = [];
        for (const childNum of issue.childIssues) {
          try {
            const child = await this.githubAPI.getIssue(childNum);
            const childRel = issue.relationships.find((r) => r.issueNumber === childNum);
            context.childIssues.push({
              number: child.number,
              title: child.title,
              state: child.state,
              relationshipType: childRel?.type || 'child',
              completed: childRel?.completed,
            });
          } catch (error) {
            console.warn(`Could not fetch child issue #${childNum}`);
          }
        }
      }

      // Add other related issues (blocks, blocked-by, etc.)
      const otherRelated = issue.relationships.filter(
        (r) =>
          r.issueNumber !== issue.parentIssue &&
          !issue.childIssues?.includes(r.issueNumber) &&
          ['blocks', 'blocked-by', 'related'].includes(r.type)
      );

      if (otherRelated.length > 0) {
        context.relatedIssues = [];
        for (const rel of otherRelated) {
          try {
            const related = await this.githubAPI.getIssue(rel.issueNumber);
            context.relatedIssues.push({
              number: related.number,
              title: related.title,
              state: related.state,
              relationshipType: rel.type,
            });
          } catch (error) {
            console.warn(`Could not fetch related issue #${rel.issueNumber}`);
          }
        }
      }
    }

    const prompt = buildEvaluationPrompt(context);

    // Call Claude via CLI
    try {
      $.verbose = false; // Suppress command output
      const result = await $`echo ${prompt} | ${this.claudePath} --dangerously-skip-permissions chat --output-format json 2>/dev/null`;
      $.verbose = true;

      // Parse the JSON response
      let responseText = result.stdout.trim();

      // Extract JSON if it's wrapped in markdown code blocks
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        responseText = jsonMatch[1].trim();
      }

      // Find the first { and last } to extract just the JSON object
      const firstBrace = responseText.indexOf('{');
      const lastBrace = responseText.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        responseText = responseText.substring(firstBrace, lastBrace + 1);
      }

      let response;
      try {
        response = JSON.parse(responseText);
      } catch (parseError: any) {
        // Log the problematic JSON for debugging
        console.error(chalk.red(`\nFailed to parse JSON for issue #${issue.number}:`));
        console.error(chalk.dim('Raw response (first 200 chars):'), responseText.substring(0, 200));
        throw parseError;
      }

      // Calculate AI priority score (weighted average of AI metrics)
      const aiPriorityScore = this.calculateAIPriorityScore(response.scores);

      const evaluation: IssueEvaluation = {
        issueNumber: issue.number,
        issueTitle: issue.title,
        lastModified: issue.updatedAt,
        lastEvaluated: new Date().toISOString(),
        classification: response.classification,
        scores: {
          ...response.scores,
          aiPriorityScore,
        },
        hasEnoughDetail: response.hasEnoughDetail,
        reasoning: response.reasoning,
        suggestedQuestions: response.suggestedQuestions,
        estimatedEffort: response.estimatedEffort,
      };

      return evaluation;
    } catch (error: any) {
      // If Claude fails, create a minimal evaluation
      console.warn(chalk.yellow(`Warning: Claude evaluation failed for issue #${issue.number}: ${error.message || error}`));

      return {
        issueNumber: issue.number,
        issueTitle: issue.title,
        lastModified: issue.updatedAt,
        lastEvaluated: new Date().toISOString(),
        classification: {
          // NOTE: Area and Issue Type removed - read from project instead
          complexity: 'medium',
          impact: 'medium',
        },
        scores: {
          clarity: 5,
          importance: 5,
          feasibility: 5,
          aiPriorityScore: 5,
        },
        hasEnoughDetail: !!issue.body && issue.body.length > 100,
        reasoning: 'Auto-evaluation (Claude unavailable)',
      };
    }
  }

  /**
   * Calculate AI priority score from individual scores
   * Weighted: clarity 25%, importance 40%, feasibility 35%
   * This is the AI's contribution (30% weight) to hybrid prioritization in Phase 1+
   */
  private calculateAIPriorityScore(scores: Omit<IssueScores, 'aiPriorityScore'>): number {
    const weights = {
      clarity: 0.25,
      importance: 0.4,
      feasibility: 0.35,
    };

    const aiPriorityScore =
      scores.clarity * weights.clarity +
      scores.importance * weights.importance +
      scores.feasibility * weights.feasibility;

    return Math.round(aiPriorityScore * 10) / 10; // Round to 1 decimal
  }

  /**
   * Get evaluation for a specific issue
   */
  getEvaluation(issueNumber: number): IssueEvaluation | null {
    if (!this.cache) {
      return null;
    }
    return this.cache.evaluations[issueNumber] || null;
  }

  /**
   * Get all evaluations sorted by AI priority score
   * NOTE: In Phase 1+, use ProjectAwarePrioritizer for hybrid scoring
   */
  getAllEvaluations(): IssueEvaluation[] {
    if (!this.cache) {
      return [];
    }
    return Object.values(this.cache.evaluations).sort(
      (a, b) => b.scores.aiPriorityScore - a.scores.aiPriorityScore
    );
  }

  /**
   * Clear evaluation cache
   */
  async clearCache(): Promise<void> {
    this.cache = {
      version: '1.0.0',
      projectName: '',
      lastUpdated: new Date().toISOString(),
      evaluations: {},
    };
    await this.saveCache();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
