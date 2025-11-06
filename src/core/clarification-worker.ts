/**
 * ClarificationWorker - Attempts to answer clarification questions autonomously
 *
 * Uses the product manager persona to research similar features in popular software
 * and provide reasonable answers to questions that were posted by the evaluator.
 */

import { $ } from 'zx';
import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { GitHubAPI } from '../github/api.js';
import { ProjectFieldMapper } from '../github/project-field-mapper.js';

interface ClarificationQuestion {
  question: string;
  number: number;
}

interface ClarificationResult {
  issueNumber: number;
  issueTitle: string;
  allAnswered: boolean;
  answers: {
    question: string;
    answer: string;
    confidence: 'high' | 'medium' | 'low' | 'none';
  }[];
  reasoning: string;
  statusUpdate: 'Todo' | 'Backlog' | null;
}

export class ClarificationWorker {
  private projectPath: string;
  private claudePath: string;
  private githubAPI: GitHubAPI | null;
  private fieldMapper: ProjectFieldMapper | null;

  constructor(
    projectPath: string,
    githubAPI: GitHubAPI | null = null,
    claudePath: string = 'claude',
    fieldMapper: ProjectFieldMapper | null = null
  ) {
    this.projectPath = projectPath;
    this.githubAPI = githubAPI;
    this.claudePath = claudePath;
    this.fieldMapper = fieldMapper;
  }

  /**
   * Process all issues with "Needs More Info" status
   */
  async processNeedsMoreInfoIssues(options: {
    verbose?: boolean;
  } = {}): Promise<ClarificationResult[]> {
    const { verbose = false } = options;

    if (!this.fieldMapper) {
      throw new Error('Field mapper is required for clarification worker');
    }

    if (!this.githubAPI) {
      throw new Error('GitHub API is required for clarification worker');
    }

    console.log(chalk.blue.bold('\n🤔 Clarification Worker\n'));
    console.log(chalk.gray('Fetching issues with "Needs More Info" status...\n'));

    // Get all items with "Needs More Info" status
    const items = await this.fieldMapper.getItemsByStatus('Needs More Info');

    if (items.length === 0) {
      console.log(chalk.yellow('No issues found with "Needs More Info" status.\n'));
      return [];
    }

    console.log(chalk.blue(`Found ${items.length} issue(s) needing clarification\n`));

    const results: ClarificationResult[] = [];

    for (const item of items) {
      try {
        const result = await this.clarifyIssue(item.issueNumber, { verbose });
        results.push(result);

        // Update status based on result
        if (result.statusUpdate) {
          await this.updateIssueStatus(item.issueNumber, result.statusUpdate, verbose);
        }
      } catch (error) {
        console.error(
          chalk.red(`✗ Failed to process issue #${item.issueNumber}:`),
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Summary
    const movedToTodo = results.filter(r => r.statusUpdate === 'Todo').length;
    const movedToBacklog = results.filter(r => r.statusUpdate === 'Backlog').length;
    const unchanged = results.filter(r => r.statusUpdate === null).length;

    console.log(chalk.blue.bold('\n📊 Clarification Summary:\n'));
    console.log(chalk.green(`  Moved to Todo: ${movedToTodo}`));
    console.log(chalk.yellow(`  Moved to Backlog: ${movedToBacklog}`));
    console.log(chalk.gray(`  Unchanged: ${unchanged}`));
    console.log(chalk.gray(`  Total: ${results.length}\n`));

    return results;
  }

  /**
   * Attempt to clarify a single issue by answering its questions
   */
  private async clarifyIssue(
    issueNumber: number,
    options: { verbose?: boolean }
  ): Promise<ClarificationResult> {
    const { verbose = false } = options;

    if (!this.githubAPI) {
      throw new Error('GitHub API is required');
    }

    if (verbose) {
      console.log(chalk.cyan(`\n━━━ Clarifying Issue #${issueNumber} ━━━`));
    }

    // Fetch issue details
    const issue = await this.githubAPI.getIssue(issueNumber);

    if (verbose) {
      console.log(chalk.cyan(`  Title: ${issue.title}`));
    }

    // Fetch comments to find clarification questions
    const comments = await this.githubAPI.getComments(issueNumber);

    // Find the most recent autonomous evaluation comment with questions
    const evaluationComment = comments
      .reverse()
      .find(c => c.body?.includes('## 🤖 Autonomous Evaluation') && c.body?.includes('Questions for Clarification:'));

    if (!evaluationComment) {
      if (verbose) {
        console.log(chalk.yellow('  ⚠️  No evaluation comment found with questions'));
      }
      return {
        issueNumber,
        issueTitle: issue.title,
        allAnswered: false,
        answers: [],
        reasoning: 'No clarification questions found in comments',
        statusUpdate: null,
      };
    }

    // Extract questions from the comment
    const questions = this.extractQuestions(evaluationComment.body || '');

    if (questions.length === 0) {
      if (verbose) {
        console.log(chalk.yellow('  ⚠️  Could not extract questions from evaluation comment'));
      }
      return {
        issueNumber,
        issueTitle: issue.title,
        allAnswered: false,
        answers: [],
        reasoning: 'No questions could be extracted',
        statusUpdate: null,
      };
    }

    if (verbose) {
      console.log(chalk.gray(`  Found ${questions.length} question(s) to answer\n`));
    }

    // Use product manager persona to answer questions
    const clarificationResult = await this.answerQuestions(
      issue.title,
      issue.body || '',
      questions,
      verbose
    );

    // Post answers as a comment
    await this.postClarificationAnswers(issueNumber, clarificationResult, verbose);

    // Determine status update based on confidence levels
    let statusUpdate: 'Todo' | 'Backlog' | null = null;

    const allHighOrMediumConfidence = clarificationResult.answers.every(
      a => a.confidence === 'high' || a.confidence === 'medium'
    );

    const anyLowOrNoConfidence = clarificationResult.answers.some(
      a => a.confidence === 'low' || a.confidence === 'none'
    );

    if (allHighOrMediumConfidence) {
      statusUpdate = 'Todo';
      if (verbose) {
        console.log(chalk.green('  ✓ All questions answered with reasonable confidence'));
        console.log(chalk.green('  → Status will be updated to: Todo\n'));
      }
    } else if (anyLowOrNoConfidence) {
      statusUpdate = 'Backlog';
      if (verbose) {
        console.log(chalk.yellow('  ⚠️  Some questions could not be answered confidently'));
        console.log(chalk.yellow('  → Status will be updated to: Backlog\n'));
      }
    }

    return {
      issueNumber,
      issueTitle: issue.title,
      allAnswered: allHighOrMediumConfidence,
      answers: clarificationResult.answers,
      reasoning: clarificationResult.reasoning,
      statusUpdate,
    };
  }

  /**
   * Extract numbered questions from evaluation comment
   */
  private extractQuestions(commentBody: string): ClarificationQuestion[] {
    const questions: ClarificationQuestion[] = [];

    // Find the "Questions for Clarification:" section
    const questionsSection = commentBody.match(/\*\*Questions for Clarification:\*\*\s*([\s\S]*?)(?:\*\*|$)/);

    if (!questionsSection) {
      return questions;
    }

    const questionsText = questionsSection[1];

    // Match numbered questions like "1. Question text?"
    const questionMatches = questionsText.matchAll(/(\d+)\.\s+([^\n]+)/g);

    for (const match of questionMatches) {
      const number = parseInt(match[1], 10);
      const question = match[2].trim();
      if (question) {
        questions.push({ number, question });
      }
    }

    return questions;
  }

  /**
   * Use Claude with product manager persona to answer questions
   */
  private async answerQuestions(
    issueTitle: string,
    issueBody: string,
    questions: ClarificationQuestion[],
    verbose: boolean
  ): Promise<{
    answers: {
      question: string;
      answer: string;
      confidence: 'high' | 'medium' | 'low' | 'none';
    }[];
    reasoning: string;
  }> {
    const prompt = this.buildClarificationPrompt(issueTitle, issueBody, questions);

    // Save prompt to temp file
    const tempPromptFile = join(this.projectPath, '.autonomous', 'clarification-prompt.txt');
    await fs.mkdir(join(this.projectPath, '.autonomous'), { recursive: true });
    await fs.writeFile(tempPromptFile, prompt, 'utf-8');

    if (verbose) {
      console.log(chalk.gray('  Consulting product manager persona...\n'));
    }

    // Call Claude CLI
    $.cwd = this.projectPath;
    $.verbose = false;

    let result;
    try {
      const originalEnv = $.env;
      $.env = { ...process.env };
      delete $.env.ANTHROPIC_API_KEY;
      result = await $`${this.claudePath} --print < ${tempPromptFile}`;
      $.env = originalEnv;
    } catch (cmdError: any) {
      $.env = process.env;
      const stdout = cmdError.stdout?.trim() || '';
      const stderr = cmdError.stderr?.trim() || '';

      throw new Error(`Claude CLI failed: ${stderr || stdout || 'No output'}`);
    }

    const response = result.stdout.trim();

    if (!response) {
      throw new Error('Claude returned no response');
    }

    // Parse the response
    return this.parseClarificationResponse(response, questions);
  }

  /**
   * Build prompt for product manager persona to answer questions
   */
  private buildClarificationPrompt(
    issueTitle: string,
    issueBody: string,
    questions: ClarificationQuestion[]
  ): string {
    const questionsList = questions.map(q => `${q.number}. ${q.question}`).join('\n');

    return `<persona>
You are a **Product Manager** with deep knowledge of popular software applications and industry best practices.

Your role focuses on:
- User experience and product design patterns
- Common features in successful applications
- Industry standards and conventions
- User expectations based on similar features in well-known software

Your task is to answer clarification questions about a feature request by:
1. Researching similar features in popular software (e.g., Slack, Discord, Twitter, GitHub, LinkedIn, Stripe, etc.)
2. Identifying common patterns and best practices
3. Providing reasonable answers based on what works well in similar contexts
4. Being honest about what requires specific business/technical decisions that can't be inferred
</persona>

**Issue Title:** ${issueTitle}

**Issue Description:**
${issueBody || 'No description provided'}

**Questions Requiring Clarification:**

${questionsList}

**Instructions:**

For each question, provide an answer based on:
1. How similar features work in popular, well-designed applications
2. Industry best practices and user expectations
3. What would provide the best user experience

If a question requires specific business decisions, technical constraints, or domain-specific knowledge that cannot be reasonably inferred from similar features in other software, indicate that it needs human input.

**Response Format:**

For each question, respond with:

QUESTION N: [Copy the question text]
ANSWER: [Your detailed answer based on similar features in popular software and best practices]
CONFIDENCE: [high | medium | low | none]
- high: Answer based on well-established patterns in popular software
- medium: Answer based on reasonable assumptions from similar contexts
- low: Best guess but requires validation
- none: Cannot provide reasonable answer without human input

REASONING: [At the end, provide overall reasoning about your answers, mentioning specific software examples where similar features exist]

Be specific and actionable in your answers. Mention concrete examples from popular software when applicable.`;
  }

  /**
   * Parse Claude's clarification response
   */
  private parseClarificationResponse(
    response: string,
    questions: ClarificationQuestion[]
  ): {
    answers: {
      question: string;
      answer: string;
      confidence: 'high' | 'medium' | 'low' | 'none';
    }[];
    reasoning: string;
  } {
    const answers: {
      question: string;
      answer: string;
      confidence: 'high' | 'medium' | 'low' | 'none';
    }[] = [];

    // Extract reasoning (should be at the end)
    const reasoningMatch = response.match(/REASONING:\s*([\s\S]*?)$/);
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : 'No reasoning provided';

    // Extract each answer
    for (const q of questions) {
      // Match QUESTION N: ... ANSWER: ... CONFIDENCE: ...
      const answerPattern = new RegExp(
        `QUESTION ${q.number}:[\\s\\S]*?ANSWER:\\s*([\\s\\S]*?)\\s*CONFIDENCE:\\s*(high|medium|low|none)`,
        'i'
      );

      const match = response.match(answerPattern);

      if (match) {
        const answer = match[1].trim();
        const confidence = match[2].toLowerCase() as 'high' | 'medium' | 'low' | 'none';

        answers.push({
          question: q.question,
          answer,
          confidence,
        });
      } else {
        // Couldn't parse this answer
        answers.push({
          question: q.question,
          answer: 'Could not parse answer from response',
          confidence: 'none',
        });
      }
    }

    return { answers, reasoning };
  }

  /**
   * Post clarification answers as a GitHub comment
   */
  private async postClarificationAnswers(
    issueNumber: number,
    result: {
      answers: {
        question: string;
        answer: string;
        confidence: 'high' | 'medium' | 'low' | 'none';
      }[];
      reasoning: string;
    },
    verbose: boolean
  ): Promise<void> {
    if (!this.githubAPI) {
      return;
    }

    const answersList = result.answers
      .map((a, i) => {
        const confidenceIcon = {
          high: '✅',
          medium: '⚠️',
          low: '❓',
          none: '❌',
        }[a.confidence];

        return `### ${i + 1}. ${a.question}

${confidenceIcon} **Confidence: ${a.confidence.toUpperCase()}**

${a.answer}`;
      })
      .join('\n\n---\n\n');

    const comment = `## 🤖 Autonomous Clarification

I've attempted to answer the clarification questions using product management expertise and knowledge of similar features in popular software.

${answersList}

---

**Reasoning:**
${result.reasoning}

---

*Autonomous clarification by Product Manager persona • If these answers are insufficient, this issue may require human input.*`;

    try {
      await this.githubAPI.createComment(issueNumber, comment);
      if (verbose) {
        console.log(chalk.gray('  ✓ Posted clarification answers to GitHub\n'));
      }
    } catch (error) {
      if (verbose) {
        console.log(
          chalk.yellow('  ⚠️  Failed to post clarification comment:'),
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  /**
   * Update issue status in GitHub Projects
   */
  private async updateIssueStatus(
    issueNumber: number,
    newStatus: 'Todo' | 'Backlog',
    verbose: boolean
  ): Promise<void> {
    if (!this.fieldMapper) {
      return;
    }

    try {
      const metadata = await this.fieldMapper.getMetadataForIssue(issueNumber);

      if (!metadata) {
        if (verbose) {
          console.log(chalk.yellow(`  ⚠️  Could not find project metadata for #${issueNumber}`));
        }
        return;
      }

      // Use the projectsAPI directly to update status
      const projectsAPI = (this.fieldMapper as any).projectsAPI;
      await projectsAPI.updateItemStatusByValue(metadata.projectItemId, newStatus);

      if (verbose) {
        console.log(chalk.green(`  ✓ Updated status to: ${newStatus}`));
      }
    } catch (error) {
      if (verbose) {
        console.log(
          chalk.yellow(`  ⚠️  Failed to update status:`),
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }
}
