/**
 * PersonaReviewer - Multi-persona code review system
 *
 * Uses different personas to evaluate merged changes from multiple perspectives
 */

import { $ } from 'zx';
import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { Assignment } from '../types/index.js';

export interface PersonaReview {
  persona: string;
  passed: boolean;
  feedback: string;
  reviewedAt: string;
  score?: number; // 1-10 score
}

export interface ReviewResult {
  overallPassed: boolean;
  personaReviews: PersonaReview[];
  failureReasons?: string[];
}

export interface PersonaDefinition {
  name: string;
  role: string;
  focusAreas: string[];
  passingCriteria: string[];
}

export class PersonaReviewer {
  private projectPath: string;
  private claudePath: string;
  private personas: PersonaDefinition[];

  constructor(projectPath: string, claudePath: string = 'claude') {
    this.projectPath = projectPath;
    this.claudePath = claudePath;
    this.personas = this.getDefaultPersonas();
  }

  /**
   * Get default persona definitions
   */
  private getDefaultPersonas(): PersonaDefinition[] {
    return [
      {
        name: 'architect',
        role: 'Software Architect',
        focusAreas: [
          'Requirements coverage',
          'System design',
          'Implementation completeness',
          'Technical correctness',
        ],
        passingCriteria: [
          'All requirements from the issue are implemented',
          'The implementation matches the specified design',
          'Code is complete and functional',
          'No major technical issues or gaps',
        ],
      },
      {
        name: 'product-manager',
        role: 'Product Manager',
        focusAreas: [
          'Requirements coverage',
          'User value delivery',
          'Acceptance criteria',
          'Feature completeness',
        ],
        passingCriteria: [
          'All requirements from the original issue are addressed',
          'The solution solves the stated problem',
          'User-facing changes are clear and valuable',
          'No scope creep or unrelated changes',
        ],
      },
      {
        name: 'senior-engineer',
        role: 'Senior Software Engineer',
        focusAreas: [
          'Code quality',
          'Architecture',
          'Maintainability',
          'Best practices',
        ],
        passingCriteria: [
          'Code follows project conventions and style',
          'No obvious bugs or logic errors',
          'Proper error handling',
          'Code is readable and well-structured',
          'No code smells or anti-patterns',
        ],
      },
      {
        name: 'qa-engineer',
        role: 'QA Engineer',
        focusAreas: [
          'Test coverage',
          'Edge cases',
          'Error scenarios',
          'Regression risk',
        ],
        passingCriteria: [
          'Critical paths have test coverage',
          'Edge cases are handled',
          'Error scenarios are tested',
          'No obvious gaps in testing',
        ],
      },
      {
        name: 'security-engineer',
        role: 'Security Engineer',
        focusAreas: [
          'Security vulnerabilities',
          'Data validation',
          'Authentication/Authorization',
          'Sensitive data handling',
        ],
        passingCriteria: [
          'No obvious security vulnerabilities',
          'User input is validated',
          'Secrets are not hardcoded',
          'Proper access control where applicable',
        ],
      },
    ];
  }

  /**
   * Review changes from multiple personas
   */
  async reviewChanges(assignment: Assignment, options: {
    worktreePath: string;
    branchName: string;
    diff: string;
    quiet?: boolean;
    personas?: string[]; // Filter to specific personas
  }): Promise<ReviewResult> {
    const personaReviews: PersonaReview[] = [];
    const failureReasons: string[] = [];

    // Filter personas based on options
    let personasToRun = this.personas;
    if (options.personas && options.personas.length > 0) {
      if (options.personas.includes('all')) {
        // Run all personas
        personasToRun = this.personas;
      } else {
        // Filter to requested personas
        personasToRun = this.personas.filter(p => options.personas!.includes(p.name));
      }
    } else {
      // Default to just architect
      personasToRun = this.personas.filter(p => p.name === 'architect');
    }

    if (!options.quiet) {
      const personaList = personasToRun.map(p => p.role).join(', ');
      console.log(chalk.blue(`\n🔍 Starting review for issue #${assignment.issueNumber}...`));
      console.log(chalk.gray(`  Personas: ${personaList}`));
    }

    for (const persona of personasToRun) {
      const review = await this.reviewWithPersona(persona, assignment, options);
      personaReviews.push(review);

      if (!review.passed) {
        failureReasons.push(`${persona.role}: ${review.feedback}`);
      }

      // Log review result
      if (!options.quiet) {
        if (review.passed) {
          console.log(chalk.green(`  ✓ ${persona.role}: PASSED`));
          if (review.feedback && review.feedback.length < 200) {
            console.log(chalk.gray(`    ${review.feedback}`));
          }
        } else {
          console.log(chalk.red(`  ✗ ${persona.role}: FAILED`));
          // Show feedback for failures (truncate if too long)
          console.log(chalk.yellow(`    ${review.feedback}`));
        }
      }

      // Exit early on first failure - no need to run other personas
      if (!review.passed) {
        if (!options.quiet) {
          console.log(chalk.gray(`  ⏭  Skipping remaining personas (early exit on failure)\n`));
        }
        break;
      }
    }

    const overallPassed = personaReviews.every(r => r.passed);

    if (!options.quiet) {
      console.log(chalk.blue(`\n📊 Review Summary:`));
      console.log(`  Passed: ${personaReviews.filter(r => r.passed).length}/${personaReviews.length}`);
      console.log(`  Overall: ${overallPassed ? chalk.green('PASSED') : chalk.red('FAILED')}\n`);
    }

    return {
      overallPassed,
      personaReviews,
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
    };
  }

  /**
   * Review from a single persona's perspective
   */
  private async reviewWithPersona(
    persona: PersonaDefinition,
    assignment: Assignment,
    options: {
      worktreePath: string;
      branchName: string;
      diff: string;
    }
  ): Promise<PersonaReview> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      const prompt = this.buildPersonaPrompt(persona, assignment, options);

      // Save prompt to temp file in .autonomous/reviews/ directory
      // (include issue number to avoid conflicts in concurrent reviews)
      const reviewsDir = join(this.projectPath, '.autonomous', 'reviews');
      const tempPromptFile = join(reviewsDir, `review-${assignment.issueNumber}-${persona.name}-prompt.txt`);
      await fs.mkdir(reviewsDir, { recursive: true });
      await fs.writeFile(tempPromptFile, prompt, 'utf-8');

      // Call Claude CLI with persona tag in prompt
      // Use --print mode to share budget with main Claude Code session
      // Unset ANTHROPIC_API_KEY to avoid using API billing
      let result;
      try {
        const originalEnv = $.env;
        $.env = { ...process.env };
        delete $.env.ANTHROPIC_API_KEY;
        result = await $`${this.claudePath} --print < ${tempPromptFile}`;
        $.env = originalEnv;
      } catch (cmdError: any) {
        // Restore env even on error
        $.env = process.env;
        // Capture both stdout and stderr from failed command
        const stdout = cmdError.stdout?.trim() || '';
        const stderr = cmdError.stderr?.trim() || '';
        const exitCode = cmdError.exitCode || 1;

        console.error(chalk.red(`  ✗ ${persona.role} review command failed (exit ${exitCode})`));
        if (stderr) console.error(chalk.gray(`    stderr: ${stderr.substring(0, 200)}`));

        return {
          persona: persona.name,
          passed: false,
          feedback: `CLI error: ${stderr || stdout || 'Command failed with no output'}`,
          reviewedAt: new Date().toISOString(),
        };
      }

      const response = result.stdout.trim();

      // Check if we got any response
      if (!response) {
        return {
          persona: persona.name,
          passed: false,
          feedback: 'Claude returned no response - check CLI configuration',
          reviewedAt: new Date().toISOString(),
        };
      }

      // Parse response
      const parsedReview = this.parseReviewResponse(response);

      return {
        persona: persona.name,
        passed: parsedReview.passed,
        feedback: parsedReview.feedback,
        score: parsedReview.score,
        reviewedAt: new Date().toISOString(),
      };
    } catch (error) {
      // If review fails for any other reason, mark as failed
      console.error(chalk.red(`  ✗ ${persona.role} review encountered an error`));
      console.error(error);

      return {
        persona: persona.name,
        passed: false,
        feedback: `Unexpected error during review: ${error instanceof Error ? error.message : String(error)}`,
        reviewedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Build review prompt for a persona
   */
  private buildPersonaPrompt(
    persona: PersonaDefinition,
    assignment: Assignment,
    options: {
      worktreePath: string;
      branchName: string;
      diff: string;
    }
  ): string {
    const hasDiff = options.diff && options.diff.trim().length > 0;

    if (hasDiff) {
      // Traditional diff-based code review
      return `<persona>
You are a **${persona.role}** reviewing a code change for merge approval.

Your role focuses on: ${persona.focusAreas.join(', ')}

Your passing criteria:
${persona.passingCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}
</persona>

**Context:**
- Issue #${assignment.issueNumber}: ${assignment.issueTitle}
- Branch: ${options.branchName}
- Worktree: ${options.worktreePath}

**Original Issue Description:**
${assignment.issueBody || 'No description provided'}

**Changes Made (git diff):**
\`\`\`diff
${options.diff.substring(0, 10000)}${options.diff.length > 10000 ? '\n... (truncated)' : ''}
\`\`\`

**Instructions:**
1. Review the changes from your perspective as a ${persona.role}
2. Evaluate against your criteria above
3. Determine if this change should be approved or rejected
4. Provide specific, actionable feedback

**Response Format:**
You must respond in this exact format:

DECISION: [PASS or FAIL]
SCORE: [1-10]
FEEDBACK: [Your detailed feedback here. Be specific about what passed or failed. If FAIL, clearly state what needs to be fixed.]

**Important:**
- Be strict but fair
- If there are critical issues, mark as FAIL
- If there are minor suggestions but nothing blocking, mark as PASS
- Focus on your area of expertise
- Provide actionable feedback`;
    } else {
      // Requirements verification mode
      return `<persona>
You are a **${persona.role}** verifying if requirements have been implemented in the codebase.

Your role focuses on: ${persona.focusAreas.join(', ')}

Your passing criteria:
${persona.passingCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}
</persona>

**Context:**
- Issue #${assignment.issueNumber}: ${assignment.issueTitle}
- Branch: ${options.branchName}
- Worktree: ${options.worktreePath}

**Issue Requirements:**
${assignment.issueBody || 'No description provided'}

**Instructions:**
You are in the codebase directory: ${options.worktreePath}

Your task is to verify if the requirements described in the issue have been implemented in the current state of the \`${options.branchName}\` branch.

1. Use tools to explore the codebase (search for files, read code, etc.)
2. Look for evidence that the requirements have been implemented
3. Evaluate from your perspective as a ${persona.role}
4. Determine if the requirements are fully met or what's missing

**Response Format:**
You must respond in this exact format:

DECISION: [PASS or FAIL]
SCORE: [1-10]
FEEDBACK: [Your detailed feedback. If PASS, explain what you found that satisfies the requirements. If FAIL, list specific requirements that are missing or incomplete and what needs to be done.]

**Important:**
- PASS only if ALL requirements from your perspective are fully implemented
- FAIL if any requirements are missing, incomplete, or incorrectly implemented
- Be specific about what you found (or didn't find)
- Provide actionable feedback on what needs to be added/fixed

**Your Review:**`;
    }
  }

  /**
   * Parse Claude's review response
   */
  private parseReviewResponse(response: string): {
    passed: boolean;
    feedback: string;
    score?: number;
  } {
    // Extract DECISION
    const decisionMatch = response.match(/DECISION:\s*(PASS|FAIL)/i);
    const passed = decisionMatch ? decisionMatch[1].toUpperCase() === 'PASS' : false;

    // Extract SCORE
    const scoreMatch = response.match(/SCORE:\s*(\d+)/);
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : undefined;

    // Extract FEEDBACK
    const feedbackMatch = response.match(/FEEDBACK:\s*([\s\S]*)/);
    let feedback = feedbackMatch ? feedbackMatch[1].trim() : response;

    // If no decision was found, the response format was wrong
    if (!decisionMatch) {
      feedback = `[Invalid response format - using raw response]\n\n${response}`;
    }

    // Ensure feedback is not empty
    if (!feedback || feedback.trim().length === 0) {
      feedback = 'No feedback provided';
    }

    return {
      passed,
      feedback,
      score,
    };
  }

  /**
   * Set custom personas
   */
  setPersonas(personas: PersonaDefinition[]): void {
    this.personas = personas;
  }

  /**
   * Add a persona
   */
  addPersona(persona: PersonaDefinition): void {
    this.personas.push(persona);
  }

  /**
   * Get current personas
   */
  getPersonas(): PersonaDefinition[] {
    return this.personas;
  }
}
