/**
 * Unassign command - Stop work on a specific issue and clean up
 */

import chalk from 'chalk';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ConfigManager } from '../../core/config-manager.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { ClaudeAdapter } from '../../llm/claude-adapter.js';
import { $ } from 'zx';
import * as readline from 'readline';

interface UnassignOptions {
  cleanup?: boolean;
  force?: boolean;
}

/**
 * Simple prompt function using readline
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export async function unassignCommand(issueNumber: string, options: UnassignOptions): Promise<void> {
  console.log(chalk.blue.bold(`\n🔓 Unassigning Issue #${issueNumber}\n`));

  try {
    const cwd = process.cwd();
    const issueNum = parseInt(issueNumber, 10);

    if (isNaN(issueNum)) {
      console.error(chalk.red('Error: Issue number must be a valid integer'));
      process.exit(1);
    }

    // Load configuration and assignment manager
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();

    const { basename } = await import('path');
    const projectName = basename(cwd);
    const assignmentManager = new AssignmentManager(cwd);
    await assignmentManager.initialize(projectName, cwd);

    // Find the assignment
    const assignment = assignmentManager.getAllAssignments().find((a) => a.issueNumber === issueNum);

    if (!assignment) {
      console.log(chalk.yellow(`Issue #${issueNum} is not currently assigned`));
      return;
    }

    console.log(chalk.gray(`Found assignment:`));
    console.log(chalk.gray(`  Title: ${assignment.issueTitle}`));
    console.log(chalk.gray(`  Status: ${assignment.status}`));
    console.log(chalk.gray(`  LLM: ${assignment.llmProvider}`));
    console.log(chalk.gray(`  Branch: ${assignment.branchName}`));
    console.log(chalk.gray(`  Worktree: ${assignment.worktreePath}`));

    // Confirm if not forced
    if (!options.force) {
      const answer = await prompt(chalk.cyan('\nAre you sure you want to unassign this issue? [y/N]: '));
      if (answer !== 'y' && answer !== 'yes') {
        console.log(chalk.gray('Cancelled'));
        return;
      }
    }

    // Step 1: Stop Claude instance if running
    if (assignment.status === 'in-progress' && assignment.llmInstanceId) {
      console.log(chalk.blue('\n🛑 Stopping Claude instance...'));
      try {
        const autonomousDataDir = join(cwd, '.autonomous');
        const claudeConfig = configManager.getLLMConfig(assignment.llmProvider);
        const claudeAdapter = new ClaudeAdapter(claudeConfig, autonomousDataDir);
        await claudeAdapter.stop(assignment.llmInstanceId);
        console.log(chalk.green('  ✓ Claude instance stopped'));
      } catch (error: unknown) {
        console.warn(chalk.yellow(`  ⚠️  Could not stop instance: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    // Step 2: Remove assignment from tracking
    console.log(chalk.blue('\n📝 Removing assignment...'));
    await assignmentManager.deleteAssignment(assignment.id);
    console.log(chalk.green('  ✓ Assignment removed'));

    // Step 3: Handle worktree cleanup
    const worktreePath = assignment.worktreePath;
    let shouldCleanup = options.cleanup;

    if (shouldCleanup === undefined && !options.force) {
      // Ask user if they want to clean up worktree
      const cleanupAnswer = await prompt(
        chalk.cyan(`\nDelete worktree at ${worktreePath}? [y/N]: `)
      );
      shouldCleanup = cleanupAnswer === 'y' || cleanupAnswer === 'yes';
    }

    if (shouldCleanup) {
      console.log(chalk.blue('\n🧹 Cleaning up worktree...'));
      try {
        $.verbose = false;

        // Check if worktree exists
        try {
          await fs.access(worktreePath);

          // Remove worktree
          await $`git worktree remove ${worktreePath} --force`;
          console.log(chalk.green('  ✓ Worktree removed'));

          // Optionally delete branch
          if (!options.force) {
            const deleteBranchAnswer = await prompt(
              chalk.cyan(`Delete branch ${assignment.branchName}? [y/N]: `)
            );
            if (deleteBranchAnswer === 'y' || deleteBranchAnswer === 'yes') {
              try {
                await $`git branch -D ${assignment.branchName}`;
                console.log(chalk.green('  ✓ Branch deleted'));
              } catch (error: unknown) {
                console.warn(chalk.yellow(`  ⚠️  Could not delete branch: ${error instanceof Error ? error.message : String(error)}`));
              }
            }
          }
        } catch {
          console.log(chalk.gray('  Worktree already removed'));
        }
      } catch (error: unknown) {
        console.warn(chalk.yellow(`  ⚠️  Could not clean up worktree: ${error instanceof Error ? error.message : String(error)}`));
        console.log(chalk.gray(`  You may need to manually remove: ${worktreePath}`));
      }
    } else {
      console.log(chalk.gray('\nℹ️  Worktree preserved at: ' + worktreePath));
      console.log(chalk.gray('   To remove manually: git worktree remove ' + worktreePath));
    }

    // Clean up log files
    console.log(chalk.blue('\n🧹 Cleaning up log files...'));
    const autonomousDataDir = join(cwd, '.autonomous');
    const filesToClean = [
      `output-${assignment.llmInstanceId}.log`,
      `instance-${assignment.llmInstanceId}.json`,
      `prompt-${assignment.llmInstanceId}.txt`,
      `start-${assignment.llmInstanceId}.sh`,
      `session-${assignment.llmInstanceId}.json`,
      `activity-${assignment.llmInstanceId}.log`,
    ];

    for (const file of filesToClean) {
      try {
        await fs.unlink(join(autonomousDataDir, file));
      } catch {
        // Ignore if file doesn't exist
      }
    }
    console.log(chalk.green('  ✓ Log files cleaned'));

    console.log(chalk.green.bold('\n✓ Issue #' + issueNum + ' unassigned successfully!'));

    if (!shouldCleanup) {
      console.log(chalk.gray('\n💡 Tip: You can still work in the worktree if needed'));
      console.log(chalk.gray('   cd ' + worktreePath));
    }
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error unassigning issue:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
