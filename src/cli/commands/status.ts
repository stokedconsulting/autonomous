/**
 * Status command implementation
 */

import { AssignmentManager } from '../../core/assignment-manager.js';
import { Assignment, AssignmentStatus } from '../../types/index.js';
import chalk from 'chalk';
import { join } from 'path';
import { existsSync } from 'fs';

interface StatusOptions {
  json?: boolean;
  watch?: boolean;
  verbose?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  try {
    const cwd = process.cwd();

    if (options.watch) {
      // Watch mode - continuously update
      console.log(chalk.blue('Watch mode - Press Ctrl+C to exit\n'));

      const displayStatus = async () => {
        console.clear();
        await showStatus(cwd, options);
      };

      await displayStatus();
      setInterval(displayStatus, 5000); // Update every 5 seconds

      // Keep process running
      await new Promise(() => {});
    } else {
      // Single status display
      await showStatus(cwd, options);
    }
  } catch (error: unknown) {
    console.error(chalk.red('Error getting status:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function showStatus(cwd: string, options: StatusOptions): Promise<void> {
  const assignmentManager = new AssignmentManager(cwd);
  const { basename } = await import('path');
  const projectName = basename(cwd);

  try {
    await assignmentManager.initialize(projectName, cwd);
  } catch {
    console.log(chalk.yellow('No assignments file found.'));
    console.log('Run "auto start" to begin.');
    return;
  }

  const allAssignments = assignmentManager.getAllAssignments();

  if (options.json) {
    console.log(JSON.stringify(allAssignments, null, 2));
    return;
  }

  console.log(chalk.blue.bold('Autonomous Status\n'));

  if (allAssignments.length === 0) {
    console.log(chalk.gray('No assignments yet.'));
    console.log('Run "auto start" to begin processing issues.');
    return;
  }

  // Group by status
  const byStatus: Record<AssignmentStatus, Assignment[]> = {
    assigned: [],
    'in-progress': [],
    'in-review': [],
    'dev-complete': [],
    'merge-review': [],
    'stage-ready': [],
    merged: [],
  };

  allAssignments.forEach((assignment) => {
    // Handle invalid/missing status
    if (!assignment.status || !(assignment.status in byStatus)) {
      console.warn(chalk.yellow(`Warning: Assignment #${assignment.issueNumber} has invalid status: ${assignment.status}`));
      return;
    }
    byStatus[assignment.status].push(assignment);
  });

  // Display statistics
  const total = allAssignments.length;
  const assigned = byStatus.assigned.length;
  const inProgress = byStatus['in-progress'].length;
  const devComplete = byStatus['dev-complete'].length;
  const mergeReview = byStatus['merge-review'].length;
  const stageReady = byStatus['stage-ready'].length;
  const merged = byStatus.merged.length;

  console.log(chalk.bold('Summary:'));
  console.log(`  Total assignments: ${total}`);
  console.log(`  ${chalk.gray('Assigned')}: ${assigned}`);
  console.log(`  ${chalk.yellow('In progress')}: ${inProgress}`);
  console.log(`  ${chalk.cyan('Dev complete')}: ${devComplete}`);
  console.log(`  ${chalk.magenta('Merge review')}: ${mergeReview}`);
  console.log(`  ${chalk.blueBright('Stage ready')}: ${stageReady}`);
  console.log(`  ${chalk.green('Merged')}: ${merged}`);
  console.log();

  // Choose display function based on verbose flag
  const displayFn = options.verbose ? displayAssignmentVerbose : displayAssignment;

  // Display each status group
  if (byStatus['in-progress'].length > 0) {
    console.log(chalk.yellow.bold('⏳ In Progress:\n'));
    byStatus['in-progress'].forEach(displayFn);
  }

  if (byStatus.assigned.length > 0) {
    console.log(chalk.blue.bold('📋 Assigned:\n'));
    byStatus.assigned.forEach(displayFn);
  }

  if (byStatus['dev-complete'].length > 0) {
    console.log(chalk.cyan.bold('✅ Dev Complete (Awaiting Merge Worker):\n'));
    byStatus['dev-complete'].forEach(displayFn);
  }

  if (byStatus['merge-review'].length > 0) {
    console.log(chalk.magenta.bold('🔍 Merge Review (Being Evaluated):\n'));
    byStatus['merge-review'].forEach(displayFn);
  }

  if (byStatus['stage-ready'].length > 0) {
    console.log(chalk.blueBright.bold('🚀 Stage Ready (Awaiting Main Merge):\n'));
    byStatus['stage-ready'].forEach(displayFn);
  }

  if (byStatus.merged.length > 0) {
    console.log(chalk.green.bold('🎉 Merged to Main:\n'));
    byStatus.merged.forEach(displayFn);
  }
}

function displayAssignment(assignment: Assignment): void {
  const statusIcon = getStatusIcon(assignment.status);
  const ciStatus = assignment.ciStatus ? formatCIStatus(assignment.ciStatus) : '';

  console.log(`${statusIcon} Issue #${assignment.issueNumber}: ${chalk.bold(assignment.issueTitle)}`);
  console.log(`   LLM: ${assignment.llmProvider} | Branch: ${assignment.branchName}`);

  if (assignment.prUrl) {
    console.log(`   PR: ${assignment.prUrl} ${ciStatus}`);
  }

  // Show log file location for in-progress assignments
  if (assignment.status === 'in-progress' && assignment.llmInstanceId) {
    const logsDir = join(process.cwd(), '.autonomous', 'logs');
    const logFile = join(logsDir, `output-${assignment.llmInstanceId}.log`);
    const legacyLogFile = join(process.cwd(), '.autonomous', `output-${assignment.llmInstanceId}.log`);
    const resolvedLogFile = existsSync(logFile) ? logFile : legacyLogFile;
    if (existsSync(resolvedLogFile)) {
      console.log(`   ${chalk.gray('Log:')} tail -f ${resolvedLogFile}`);
    } else {
      console.log(`   ${chalk.yellow('Log:')} ${logFile} ${chalk.gray('(not yet created)')}`);
    }
  }

  if (assignment.workSessions.length > 0) {
    const lastSession = assignment.workSessions[assignment.workSessions.length - 1];
    if (lastSession.summary) {
      console.log(`   Last: ${chalk.gray(lastSession.summary)}`);
    }
  }

  if (assignment.lastActivity) {
    const lastActivity = new Date(assignment.lastActivity);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - lastActivity.getTime()) / 1000 / 60);
    console.log(`   Updated: ${formatTimeAgo(diffMinutes)}`);
  }

  console.log();
}

function displayAssignmentVerbose(assignment: Assignment): void {
  displayAssignment(assignment);

  // Additional verbose details
  console.log(chalk.gray(`   Worktree: ${assignment.worktreePath}`));
  console.log(chalk.gray(`   Assigned: ${new Date(assignment.assignedAt).toLocaleString()}`));

  if (assignment.processId) {
    console.log(chalk.gray(`   Process ID: ${assignment.processId}`));
  }

  if (assignment.llmInstanceId) {
    console.log(chalk.gray(`   Instance ID: ${assignment.llmInstanceId}`));
  }

  if (assignment.workSessions.length > 0) {
    console.log(chalk.gray(`   Work sessions: ${assignment.workSessions.length}`));
  }

  console.log();
}

function getStatusIcon(status: AssignmentStatus): string {
  switch (status) {
    case 'assigned':
      return '📌';
    case 'in-progress':
      return '🔄';
    case 'dev-complete':
      return '✅';
    case 'merge-review':
      return '🔍';
    case 'stage-ready':
      return '🚀';
    case 'merged':
      return '✓';
    default:
      return '•';
  }
}

function formatCIStatus(status: string): string {
  switch (status) {
    case 'success':
      return chalk.green('✓ CI passing');
    case 'failure':
      return chalk.red('✗ CI failing');
    case 'pending':
      return chalk.yellow('⏳ CI running');
    default:
      return chalk.gray(`CI: ${status}`);
  }
}

function formatTimeAgo(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
