/**
 * Prompt Builder - Generates prompts for LLM instances
 */

import { Assignment } from '../types/index.js';

export interface PromptContext {
  assignment: Assignment;
  worktreePath: string;
  previousSummary?: string;
  currentState?: {
    testsWritten: boolean;
    testsPassing: boolean;
    codePushed: boolean;
    ciStatus: string | null;
  };
  requirementsCompleted?: string[];
  requirementsRemaining?: string[];
}

export class PromptBuilder {
  /**
   * Generate initial prompt for starting work on an issue
   */
  static buildInitialPrompt(context: PromptContext): string {
    const { assignment, worktreePath } = context;

    return `You are working autonomously on GitHub issue #${assignment.issueNumber}: ${assignment.issueTitle}

Issue Details:
${assignment.issueBody || 'No description provided'}

Requirements:
1. Create a feature branch (already done: ${assignment.branchName})
2. Implement the requested functionality
3. ${assignment.metadata?.requiresTests ? 'Write comprehensive tests' : 'Ensure code quality'}
4. ${assignment.metadata?.requiresTests ? 'Ensure all tests pass' : 'Test your implementation manually'}
5. ${assignment.metadata?.requiresCI ? 'Push your changes and ensure CI passes' : 'Push your changes'}
6. Create a pull request with a clear description
7. Report completion when done

Your working directory is: ${worktreePath}

When you complete a significant task or need guidance, stop and summarize your work.
The autonomous system will analyze your progress and provide next steps.

Begin by:
1. Analyzing the issue requirements
2. Reviewing the existing codebase
3. Planning your implementation approach
4. Starting with the most critical changes

Start working on this issue now.`;
  }

  /**
   * Generate continuation prompt for resuming work after process restart
   */
  static buildContinuationPrompt(context: {
    assignment: Assignment;
    worktreePath: string;
    lastSummary?: string;
  }): string {
    const { assignment, worktreePath, lastSummary } = context;

    let prompt = `Your previous session was interrupted. Resuming work on GitHub issue #${assignment.issueNumber}: ${assignment.issueTitle}\n\n`;

    if (lastSummary) {
      prompt += `Last session summary:\n${lastSummary}\n\n`;
    }

    prompt += `Issue Details:
${assignment.issueBody || 'No description provided'}

Your working directory is: ${worktreePath}
Branch: ${assignment.branchName}

Please:
1. Check the current state of your work (git status, test results, etc.)
2. Review any uncommitted or unpushed changes
3. Continue from where you left off
4. Complete the remaining requirements

Requirements:
- ${assignment.metadata?.requiresTests ? 'Write comprehensive tests' : 'Ensure code quality'}
- ${assignment.metadata?.requiresTests ? 'Ensure all tests pass' : 'Test your implementation'}
- ${assignment.metadata?.requiresCI ? 'Push changes and ensure CI passes' : 'Push your changes'}
- Create a pull request when ready

Resume working on this issue now.`;

    return prompt;
  }

  /**
   * Generate follow-up prompt based on current progress
   */
  static buildFollowUpPrompt(context: PromptContext): string {
    const { assignment, previousSummary, currentState, requirementsCompleted, requirementsRemaining } = context;

    let prompt = `Continuing work on GitHub issue #${assignment.issueNumber}: ${assignment.issueTitle}\n\n`;

    if (previousSummary) {
      prompt += `Previous work completed:\n${previousSummary}\n\n`;
    }

    if (currentState) {
      prompt += `Current State:\n`;
      prompt += `- Tests written: ${currentState.testsWritten ? '✓ Yes' : '✗ No'}\n`;
      if (currentState.testsWritten) {
        prompt += `- Tests passing: ${currentState.testsPassing ? '✓ Yes' : '✗ No'}\n`;
      }
      prompt += `- Code pushed: ${currentState.codePushed ? '✓ Yes' : '✗ No'}\n`;
      if (currentState.codePushed && currentState.ciStatus) {
        prompt += `- CI status: ${this.formatCIStatus(currentState.ciStatus)}\n`;
      }
      prompt += '\n';
    }

    if (requirementsCompleted && requirementsCompleted.length > 0) {
      prompt += `Completed Requirements:\n`;
      requirementsCompleted.forEach((req) => {
        prompt += `✓ ${req}\n`;
      });
      prompt += '\n';
    }

    if (requirementsRemaining && requirementsRemaining.length > 0) {
      prompt += `Remaining Requirements:\n`;
      requirementsRemaining.forEach((req) => {
        prompt += `□ ${req}\n`;
      });
      prompt += '\n';
    }

    prompt += this.generateNextSteps(currentState, assignment);

    return prompt;
  }

  /**
   * Generate completion prompt
   */
  static buildCompletionPrompt(context: PromptContext): string {
    const { assignment } = context;

    return `Issue #${assignment.issueNumber} appears to be complete!

All requirements have been met:
✓ Implementation complete
✓ Tests written and passing
✓ Code pushed to remote
✓ CI checks passing

Next steps:
1. Review your changes one final time
2. Create a pull request if you haven't already
3. Ensure the PR description clearly explains:
   - What was implemented
   - How it addresses the issue
   - Any testing that was done
   - Any breaking changes or migration notes

Once the PR is created, the autonomous system will notify the maintainers for review.

Please create the PR now if not already done.`;
  }

  /**
   * Generate prompt for handling errors or blockers
   */
  static buildErrorPrompt(error: string, context: PromptContext): string {
    const { assignment } = context;

    return `Issue encountered while working on #${assignment.issueNumber}:

Error: ${error}

Please:
1. Analyze the error carefully
2. Determine the root cause
3. Implement a fix
4. Test the fix thoroughly
5. Report the resolution

If you're unable to resolve this error after multiple attempts, explain:
- What you've tried
- Why it's not working
- What help or resources you might need`;
  }

  /**
   * Generate next steps based on current state
   */
  private static generateNextSteps(
    currentState: PromptContext['currentState'],
    assignment: Assignment
  ): string {
    if (!currentState) {
      return 'Continue implementing the feature according to the requirements.';
    }

    const steps: string[] = [];

    if (!currentState.testsWritten && assignment.metadata?.requiresTests) {
      steps.push('Write comprehensive tests for your implementation');
      steps.push('Ensure tests cover edge cases and error handling');
    } else if (currentState.testsWritten && !currentState.testsPassing) {
      steps.push('Fix failing tests - ensure all tests pass');
      steps.push('Review test output carefully for errors');
    } else if (!currentState.codePushed) {
      steps.push('Push your changes to the remote branch');
      steps.push('Ensure all commits are properly formatted');
    } else if (currentState.ciStatus === 'pending') {
      steps.push('Wait for CI to complete');
      steps.push('Monitor CI status for any issues');
    } else if (currentState.ciStatus === 'failure') {
      steps.push('Review CI failures and fix any issues');
      steps.push('Re-push changes once fixes are complete');
    } else {
      steps.push('Review your implementation one final time');
      steps.push('Create a pull request with a clear description');
    }

    let nextSteps = 'Next Steps:\n';
    steps.forEach((step, index) => {
      nextSteps += `${index + 1}. ${step}\n`;
    });

    return nextSteps;
  }

  /**
   * Format CI status for display
   */
  private static formatCIStatus(status: string): string {
    switch (status) {
      case 'success':
        return '✓ Passing';
      case 'failure':
        return '✗ Failing';
      case 'pending':
        return '⏳ Running';
      case 'error':
        return '⚠ Error';
      default:
        return status;
    }
  }
}
