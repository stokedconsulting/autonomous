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

/**
 * Completion signal constants for deterministic detection
 * These signals are output by Claude and parsed by the session analyzer
 */
export const AUTONOMOUS_SIGNALS = {
  PREFIX: 'AUTONOMOUS_SIGNAL:',
  COMPLETE: 'AUTONOMOUS_SIGNAL:COMPLETE',
  BLOCKED: 'AUTONOMOUS_SIGNAL:BLOCKED:',
  FAILED: 'AUTONOMOUS_SIGNAL:FAILED:',
  PR: 'AUTONOMOUS_SIGNAL:PR:',
} as const;

export class PromptBuilder {
  /**
   * Generate completion signal instructions to append to prompts
   * This instructs Claude to output deterministic markers for completion detection
   */
  private static getCompletionSignalInstructions(includeNoPR = false): string {
    return `
---
IMPORTANT - Completion Signals:
When you finish your work, you MUST output one of these signals on its own line:

✅ If work is complete and successful:
${AUTONOMOUS_SIGNALS.COMPLETE}

📋 If you created a PR, also output (with actual number):
${AUTONOMOUS_SIGNALS.PR}123

🚫 If blocked and need human input:
${AUTONOMOUS_SIGNALS.BLOCKED}description of what you need

❌ If you encounter an unrecoverable error:
${AUTONOMOUS_SIGNALS.FAILED}description of the failure
${includeNoPR ? '\nNote: Do NOT create a PR - your branch will be merged by the phase master.' : ''}

These signals are critical for the autonomous system to detect your completion status.
---`;
  }

  /**
   * Detect if an issue is a phase master based on title
   * Phase master detection:
   * - Title contains "MASTER" keyword (required)
   * - Title contains "Phase N" where N is an integer (NOT decimal like Phase 7.2)
   */
  static isPhaseMaster(issueTitle: string): boolean {
    // MUST have MASTER keyword
    const hasMaster = /MASTER/i.test(issueTitle);
    if (!hasMaster) {
      return false;
    }

    // Extract phase number - must be integer, not decimal
    const phaseMatch = issueTitle.match(/Phase\s+(\d+)(?:\.\d+)?/i);
    if (!phaseMatch) {
      return false;
    }

    // If there's a decimal (e.g., "Phase 7.2"), it's a work item, not a master
    const hasDecimal = /Phase\s+\d+\.\d+/i.test(issueTitle);
    return !hasDecimal;
  }

  /**
   * Detect if an issue is a phase work item (Phase N.x format)
   */
  static isPhaseWorkItem(issueTitle: string): boolean {
    // Must match "Phase N.x" pattern (decimal indicates work item)
    return /Phase\s+\d+\.\d+/i.test(issueTitle);
  }

  /**
   * Generate initial prompt for starting work on an issue
   */
  static buildInitialPrompt(context: PromptContext): string {
    const { assignment, worktreePath } = context;

    // Use phase master prompt if this is a phase master
    if (assignment.metadata?.isPhaseMaster) {
      return this.buildPhaseMasterPrompt(context);
    }

    // Use phase work item prompt if this is a work item (no PR required)
    if (this.isPhaseWorkItem(assignment.issueTitle)) {
      return this.buildPhaseWorkItemPrompt(context);
    }

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

Begin by:
1. Analyzing the issue requirements
2. Reviewing the existing codebase
3. Planning your implementation approach
4. Starting with the most critical changes

Start working on this issue now.
${this.getCompletionSignalInstructions()}`;
  }

  /**
   * Generate phase master coordination prompt
   * Phase masters coordinate completed sub-items rather than implementing
   */
  static buildPhaseMasterPrompt(context: PromptContext): string {
    const { assignment, worktreePath } = context;

    return `You are coordinating a phase master issue #${assignment.issueNumber}: ${assignment.issueTitle}

Issue Details:
${assignment.issueBody || 'No description provided'}

IMPORTANT: This is a PHASE MASTER issue, not a regular implementation task.

Your responsibilities:
1. Create a feature branch (already done: ${assignment.branchName})
2. Merge each worktree for the completed sub-items into your feature branch
   - Carefully resolve any merge conflicts that may arise
   - Ensure all sub-item changes are properly integrated
3. Run smoke tests as well as any new tests that were added in the phase
   - Ensure all tests pass
   - If tests fail, correct the code until they do while maintaining intended functionality
4. Run "auto push --pr" to create the pull request
5. Report completion summary
   - Summarize what was merged and integrated
   - Confirm all tests are passing
   - Note the PR URL
   - The system will automatically update the status after PR creation

Your working directory is: ${worktreePath}

Phase Master Workflow:
- Review the issue description for the list of completed sub-items
- Merge each sub-item's branch into this phase master branch
- Resolve conflicts carefully - understand what each sub-item was trying to accomplish
- Run comprehensive tests to ensure integration is correct
- Create PR only after all tests pass

Start by checking git status and identifying which sub-item branches need to be merged.
${this.getCompletionSignalInstructions()}`;
  }

  /**
   * Generate phase work item prompt (no PR creation, just implementation)
   */
  static buildPhaseWorkItemPrompt(context: PromptContext): string {
    const { assignment, worktreePath } = context;

    return `You are working autonomously on GitHub issue #${assignment.issueNumber}: ${assignment.issueTitle}

Issue Details:
${assignment.issueBody || 'No description provided'}

IMPORTANT: This is a PHASE WORK ITEM. Your changes will be merged into the phase master branch.

Your responsibilities:
1. Create a feature branch (already done: ${assignment.branchName})
2. Implement the requested functionality according to specifications
3. ${assignment.metadata?.requiresTests ? 'Write comprehensive tests for your implementation' : 'Ensure code quality'}
4. ${assignment.metadata?.requiresTests ? 'Ensure all tests pass' : 'Test your implementation manually'}
5. Push your changes to your feature branch
6. Report completion summary
   - DO NOT create a pull request - the phase master will merge your branch
   - Summarize what was implemented
   - Confirm tests are passing
   - The system will automatically update your status

Your working directory is: ${worktreePath}

Work Item Workflow:
- Implement your assigned functionality
- Write tests to ensure quality
- Push changes to ${assignment.branchName}
- The phase master will later merge your branch along with other work items

Start by analyzing the requirements and implementing your specific task.
${this.getCompletionSignalInstructions(true)}`;
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

Resume working on this issue now.
${this.getCompletionSignalInstructions()}`;

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