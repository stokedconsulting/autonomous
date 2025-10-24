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
import { GitHubProjectsAPI } from '../github/projects-api.js';
import { IssueRelationshipParser } from '../utils/issue-relationship-parser.js';

export class IssueEvaluator {
  private cachePath: string;
  private cache: EvaluationCache | null = null;
  private claudePath: string;
  private githubAPI: GitHubAPI | null = null;
  private projectsAPI: GitHubProjectsAPI | null = null;

  constructor(
    projectPath: string,
    claudePath: string = 'claude',
    githubAPI?: GitHubAPI,
    projectsAPI?: GitHubProjectsAPI
  ) {
    this.cachePath = join(projectPath, '.autonomous', 'issue-evaluations.json');
    this.claudePath = claudePath;
    this.githubAPI = githubAPI || null;
    this.projectsAPI = projectsAPI || null;
  }

  /**
   * Load evaluation cache from disk
   */
  async loadCache(): Promise<void> {
    try {
      const data = await fs.readFile(this.cachePath, 'utf-8');
      this.cache = JSON.parse(data);

      // Migrate old evaluation format to new schema (backward compatibility)
      if (this.cache) {
        for (const issueNum in this.cache.evaluations) {
          const evaluation = this.cache.evaluations[issueNum];

          // Migrate priority -> aiPriorityScore
          if (!evaluation.scores.aiPriorityScore && (evaluation.scores as any).priority) {
            evaluation.scores.aiPriorityScore = (evaluation.scores as any).priority;
          }
          // Ensure aiPriorityScore exists (fallback to default)
          if (!evaluation.scores.aiPriorityScore) {
            evaluation.scores.aiPriorityScore = 5;
          }

          // Add contentHash for old evaluations (they'll be re-evaluated if content changes)
          if (!evaluation.contentHash) {
            // Generate a placeholder hash - will be updated on next evaluation if content changed
            evaluation.contentHash = 'legacy';
          }
        }
      }
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
   * Generate a content hash for an issue to detect actual content changes
   * Ignores updatedAt to avoid re-evaluation when only comments are added
   */
  private generateIssueContentHash(issue: Issue): string {
    const content = JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels.map((l: any) => l.name).sort(),
    });
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  /**
   * Evaluate and prioritize a list of issues
   * Returns issues sorted by priority (highest first)
   */
  async evaluateIssues(
    issues: Issue[],
    options: { forceReeval?: boolean; verbose?: boolean; postClarificationComments?: boolean } = {}
  ): Promise<{ evaluated: IssueEvaluation[]; skipped: Issue[]; totalEvaluated: number; usedCache: number }> {
    if (!this.cache) {
      await this.loadCache();
    }

    const { forceReeval = false, verbose = false, postClarificationComments = true } = options;
    const evaluated: IssueEvaluation[] = [];
    const skipped: Issue[] = [];
    let totalEvaluated = 0;
    let usedCache = 0;

    console.log(chalk.blue(`\n🔍 Evaluating ${issues.length} issue(s)...\n`));

    for (const issue of issues) {
      // Check if we need to re-evaluate based on content hash
      const cachedEval = this.cache!.evaluations[issue.number];
      const currentContentHash = this.generateIssueContentHash(issue);

      const needsEval =
        forceReeval ||
        !cachedEval ||
        cachedEval.contentHash !== currentContentHash;

      if (needsEval) {
        if (verbose) {
          console.log(chalk.gray(`Evaluating issue #${issue.number}: ${issue.title}`));
        }

        try {
          const evaluation = await this.evaluateIssue(issue);
          totalEvaluated++;

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

            // Update project status to "Evaluated" if project integration is enabled
            if (this.projectsAPI) {
              try {
                const projectItemId = await this.projectsAPI.getProjectItemIdByIssue(issue.number);
                if (projectItemId) {
                  const statusConfig = (this.projectsAPI as any).config.fields.status;
                  await this.projectsAPI.updateItemStatusByValue(projectItemId, statusConfig.evaluatedValue);
                  if (verbose) {
                    console.log(chalk.gray(`     ✓ Updated project status to "${statusConfig.evaluatedValue}"`));
                  }
                }
              } catch (error: any) {
                if (verbose) {
                  console.log(chalk.gray(`     ⚠️  Failed to update project status: ${error.message}`));
                }
              }
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

            // Post clarification comment if enabled and we have suggested questions
            if (
              postClarificationComments &&
              this.githubAPI &&
              evaluation.suggestedQuestions &&
              evaluation.suggestedQuestions.length > 0
            ) {
              try {
                await this.postClarificationComment(issue.number, evaluation);
                if (verbose) {
                  console.log(
                    chalk.gray(`     ✓ Posted ${evaluation.suggestedQuestions.length} clarifying questions as comment`)
                  );
                }
              } catch (error: any) {
                if (verbose) {
                  console.log(chalk.gray(`     ⚠️  Failed to post comment: ${error.message}`));
                }
              }
            }

            // Update project status to "Needs more info" if project integration is enabled
            if (this.projectsAPI) {
              try {
                const projectItemId = await this.projectsAPI.getProjectItemIdByIssue(issue.number);
                if (projectItemId) {
                  const statusConfig = (this.projectsAPI as any).config.fields.status;
                  await this.projectsAPI.updateItemStatusByValue(projectItemId, statusConfig.needsMoreInfoValue);
                  if (verbose) {
                    console.log(chalk.gray(`     ✓ Updated project status to "${statusConfig.needsMoreInfoValue}"`));
                  }
                }
              } catch (error: any) {
                if (verbose) {
                  console.log(chalk.gray(`     ⚠️  Failed to update project status: ${error.message}`));
                }
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
        usedCache++;
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
          if (verbose) {
            console.log(
              chalk.gray(
                `⊘ Using cached evaluation for #${issue.number} (needs more info)`
              )
            );
          }
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
    console.log(`  ${chalk.yellow(skipped.length)} issues need more detail`);
    if (totalEvaluated > 0) {
      console.log(`  ${chalk.dim(totalEvaluated)} evaluated with AI`);
    }
    if (usedCache > 0) {
      console.log(`  ${chalk.dim(usedCache)} used cache\n`);
    } else {
      console.log('');
    }

    return { evaluated, skipped, totalEvaluated, usedCache };
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

      // Handle double-escaped JSON (when Claude CLI escapes the output)
      // Check if the response contains literal \n and \" (escaped escape sequences)
      if (responseText.includes('\\n') && responseText.includes('\\"')) {
        // Unescape the JSON: replace \\n with \n, \\" with ", and \\\\ with \\
        responseText = responseText
          .replace(/\\\\"/g, '__ESCAPED_QUOTE__') // Temporarily protect \\"
          .replace(/\\"/g, '"')                    // Replace \" with "
          .replace(/__ESCAPED_QUOTE__/g, '\\"')    // Restore \\"
          .replace(/\\\\n/g, '__ESCAPED_N__')      // Temporarily protect \\n
          .replace(/\\n/g, '\n')                   // Replace \n with actual newline
          .replace(/__ESCAPED_N__/g, '\\n')        // Restore \\n
          .replace(/\\\\\\\\/g, '\\\\')            // Replace \\\\ with \\
          .replace(/\\t/g, '\t');                  // Replace \t with actual tab
      }

      let response;
      try {
        response = JSON.parse(responseText);
      } catch (parseError: any) {
        // Log the problematic JSON for debugging
        console.error(chalk.red(`\nFailed to parse JSON for issue #${issue.number}:`));
        console.error(chalk.dim('Raw response:'));
        console.error(responseText);
        console.error(chalk.dim('\nParse error:'), parseError.message);
        throw parseError;
      }

      // Calculate AI priority score (weighted average of AI metrics)
      const aiPriorityScore = this.calculateAIPriorityScore(response.scores);

      const evaluation: IssueEvaluation = {
        issueNumber: issue.number,
        issueTitle: issue.title,
        lastModified: issue.updatedAt,
        lastEvaluated: new Date().toISOString(),
        contentHash: this.generateIssueContentHash(issue),
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
        contentHash: this.generateIssueContentHash(issue),
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

  /**
   * Post clarification comment to GitHub issue
   * Formats AI-generated suggested questions as a helpful comment
   */
  private async postClarificationComment(
    issueNumber: number,
    evaluation: IssueEvaluation
  ): Promise<void> {
    if (!this.githubAPI) {
      throw new Error('GitHub API not initialized');
    }

    if (!evaluation.suggestedQuestions || evaluation.suggestedQuestions.length === 0) {
      return;
    }

    // Format the comment
    const questionsList = evaluation.suggestedQuestions
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n');

    const comment = `## 🤖 Autonomous Evaluation

This issue needs more details before autonomous work can begin.

**AI Assessment:**
- **Complexity**: ${evaluation.classification.complexity}
- **Impact**: ${evaluation.classification.impact}
- **Clarity Score**: ${evaluation.scores.clarity}/10
- **Feasibility Score**: ${evaluation.scores.feasibility}/10

**Questions for Clarification:**

${questionsList}

**Reasoning:**
${evaluation.reasoning}

---

*Please update the issue description with these details so autonomous processing can proceed.*

<sub>Generated by [Autonomous](https://github.com/stokedconsulting/autonomous) • AI-powered issue evaluation</sub>`;

    await this.githubAPI.createComment(issueNumber, comment);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
