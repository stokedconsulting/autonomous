/**
 * Item command - Alter project items in various ways
 */

import chalk from 'chalk';
import { ConfigManager } from '../../core/config-manager.js';
import { GitHubAPI } from '../../github/api.js';
import { getGitHubToken } from '../../utils/github-token.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { spawn } from 'child_process';
import { join } from 'path';
import { promises as fs } from 'fs';

interface ItemOptions {
  verbose?: boolean;
}

/**
 * Show realtime logs for an issue
 */
export async function itemLogCommand(issueNumber: string, options: ItemOptions = {}): Promise<void> {
  console.log(chalk.blue.bold(`\n📺 Live Logs - Issue #${issueNumber}\n`));

  try {
    const cwd = process.cwd();
    const issueNum = parseInt(issueNumber, 10);

    if (isNaN(issueNum)) {
      console.error(chalk.red('Error: Issue number must be a valid integer'));
      process.exit(1);
    }

    // Load assignment manager to find the assignment
    const { basename } = await import('path');
    const projectName = basename(cwd);
    const assignmentManager = new AssignmentManager(cwd);

    try {
      await assignmentManager.initialize(projectName, cwd);
    } catch {
      console.log(chalk.yellow('No assignments file found.'));
      console.log('Run "auto start" to begin.');
      process.exit(1);
    }

    // Find assignment for this issue
    const assignment = assignmentManager.getAllAssignments().find(a => a.issueNumber === issueNum);

    if (!assignment) {
      console.error(chalk.red(`Error: No assignment found for issue #${issueNum}`));
      console.log(chalk.yellow('\nAvailable assignments:'));
      const allAssignments = assignmentManager.getAllAssignments();
      if (allAssignments.length === 0) {
        console.log(chalk.gray('  (none)'));
      } else {
        allAssignments.forEach(a => {
          console.log(chalk.gray(`  #${a.issueNumber}: ${a.issueTitle} (${a.status})`));
        });
      }
      process.exit(1);
    }

    if (!assignment.llmInstanceId) {
      console.error(chalk.red(`Error: Issue #${issueNum} has no instance ID`));
      process.exit(1);
    }

    // Check if there's an active process
    if (assignment.status !== 'in-progress') {
      console.log(chalk.yellow(`⚠️  Issue #${issueNum} is not in progress (status: ${assignment.status})`));
      console.log(chalk.gray('Showing logs from last session...\n'));
    }

    const autonomousDataDir = join(cwd, '.autonomous');
    const logFile = join(autonomousDataDir, 'logs', `output-${assignment.llmInstanceId}.log`);

    // Check if log file exists
    try {
      await fs.access(logFile);
    } catch {
      console.error(chalk.red(`Error: Log file not found: ${logFile}`));
      process.exit(1);
    }

    console.log(chalk.blue(`${'='.repeat(80)}`));
    console.log(chalk.blue.bold(`  Issue #${issueNum}: ${assignment.issueTitle}`));
    console.log(chalk.blue(`  Instance: ${assignment.llmInstanceId}`));
    console.log(chalk.blue(`  Status: ${assignment.status}`));
    console.log(chalk.blue(`  Log: ${logFile}`));
    console.log(chalk.blue(`${'='.repeat(80)}\n`));

    // Read existing content first
    const existingContent = await fs.readFile(logFile, 'utf-8');
    if (existingContent) {
      process.stdout.write(existingContent);
    }

    // Start tailing the log file
    console.log(chalk.blue(`\n${'='.repeat(80)}`));
    console.log(chalk.blue.bold('  LIVE OUTPUT (Press Ctrl+C to exit)'));
    console.log(chalk.blue(`${'='.repeat(80)}\n`));

    const tail = spawn('tail', ['-f', '-n', '0', logFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    tail.stdout.on('data', (data) => {
      process.stdout.write(data.toString());
    });

    tail.stderr.on('data', (data) => {
      process.stderr.write(chalk.red('ERROR: ') + data.toString());
    });

    tail.on('close', (code) => {
      console.log(chalk.blue(`\n${'='.repeat(80)}`));
      console.log(chalk.blue(`  Session ended (exit code: ${code})`));
      console.log(chalk.blue(`${'='.repeat(80)}\n`));
      process.exit(code || 0);
    });

    // Monitor assignment status for completion
    const statusCheckInterval = setInterval(async () => {
      try {
        // In-memory assignments are always up-to-date
        const updatedAssignment = assignmentManager.getAllAssignments().find(a => a.issueNumber === issueNum);

        if (updatedAssignment && updatedAssignment.status !== assignment.status) {
          // Status changed
          if (updatedAssignment.status === 'dev-complete' || updatedAssignment.status === 'merged') {
            console.log(chalk.green(`\n${'='.repeat(80)}`));
            console.log(chalk.green.bold(`  ✓ DEV WORK COMPLETED - Issue #${issueNum}`));
            console.log(chalk.green(`  Status: ${updatedAssignment.status}`));
            if (updatedAssignment.status === 'dev-complete') {
              console.log(chalk.cyan(`  Next: Awaiting merge worker for review and stage integration`));
            }
            if (updatedAssignment.prUrl) {
              console.log(chalk.green(`  PR: ${updatedAssignment.prUrl}`));
            }
            console.log(chalk.green(`${'='.repeat(80)}\n`));

            clearInterval(statusCheckInterval);
            tail.kill();
            process.exit(0);
          }
        }
      } catch (error) {
        // Ignore errors during status check
      }
    }, 5000); // Check every 5 seconds

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log(chalk.blue(`\n${'='.repeat(80)}`));
      console.log(chalk.blue('  Stopped watching logs'));
      console.log(chalk.blue(`${'='.repeat(80)}\n`));
      clearInterval(statusCheckInterval);
      tail.kill();
      process.exit(0);
    });

    // Keep process running
    await new Promise(() => {});

  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error showing logs:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error);
    }
    process.exit(1);
  }
}

/**
 * Toggle a label on a GitHub issue
 */
export async function itemCommand(issueNumber: string, labelName: string, options: ItemOptions = {}): Promise<void> {
  console.log(chalk.blue.bold(`\n🏷️  Toggling Label on Issue #${issueNumber}\n`));

  try {
    const cwd = process.cwd();
    const issueNum = parseInt(issueNumber, 10);

    if (isNaN(issueNum)) {
      console.error(chalk.red('Error: Issue number must be a valid integer'));
      process.exit(1);
    }

    if (!labelName || labelName.trim() === '') {
      console.error(chalk.red('Error: Label name is required'));
      process.exit(1);
    }

    // Load configuration
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    // Get GitHub token
    const githubToken = await getGitHubToken(config.github.token);

    // Initialize GitHub API
    const githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);

    // Fetch issue to check current labels
    console.log(chalk.blue(`Fetching issue #${issueNum}...`));
    const issue = await githubAPI.getIssue(issueNum);

    if (options.verbose) {
      console.log(chalk.gray(`  Title: ${issue.title}`));
    }

    // Check if label already exists
    const hasLabel = issue.labels.some(label => label.name === labelName);

    if (hasLabel) {
      // Remove the label
      console.log(chalk.yellow(`  Label "${labelName}" is currently present - removing it...`));
      await githubAPI.removeLabel(issueNum, labelName);
      console.log(chalk.green(`✓ Label "${labelName}" removed from issue #${issueNum}`));
    } else {
      // Add the label
      console.log(chalk.blue(`  Label "${labelName}" is not present - adding it...`));
      await githubAPI.addLabels(issueNum, [labelName]);
      console.log(chalk.green(`✓ Label "${labelName}" added to issue #${issueNum}`));
    }

    // Show current labels
    const updatedIssue = await githubAPI.getIssue(issueNum);
    console.log(chalk.gray(`\nCurrent labels: ${updatedIssue.labels.map(l => l.name).join(', ') || '(none)'}`));

  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Label does not exist')) {
      console.error(chalk.red('\n✗ Error: Label does not exist in this repository'));
      console.log(chalk.yellow('\nCreate the label first using:'));
      console.log(chalk.gray(`  gh label create "${labelName}" --description "..." --color "d73a4a"`));
    } else {
      console.error(chalk.red('\n✗ Error toggling label:'), error instanceof Error ? error.message : String(error));
      if (options.verbose && error instanceof Error) {
        console.error(error);
      }
    }
    process.exit(1);
  }
}
