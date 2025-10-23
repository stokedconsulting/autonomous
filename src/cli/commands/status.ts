/**
 * Status command implementation
 */

import { AssignmentManager } from '../../core/assignment-manager.js';
import { Assignment, AssignmentStatus } from '../../types/index.js';
import chalk from 'chalk';

interface StatusOptions {
  json?: boolean;
  watch?: boolean;
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
  } catch (error: any) {
    console.error(chalk.red('Error getting status:'), error.message);
    process.exit(1);
  }
}

async function showStatus(cwd: string, options: StatusOptions): Promise<void> {
  const assignmentManager = new AssignmentManager(cwd);

  try {
    await assignmentManager.load();
  } catch {
    console.log(chalk.yellow('No assignments file found.'));
    console.log('Run "autonomous start" to begin.');
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
    console.log('Run "autonomous start" to begin processing issues.');
    return;
  }

  // Group by status
  const byStatus: Record<AssignmentStatus, Assignment[]> = {
    assigned: [],
    'in-progress': [],
    'llm-complete': [],
    merged: [],
  };

  allAssignments.forEach((assignment) => {
    byStatus[assignment.status].push(assignment);
  });

  // Display statistics
  const total = allAssignments.length;
  const inProgress = byStatus['in-progress'].length;
  const completed = byStatus['llm-complete'].length;
  const merged = byStatus.merged.length;

  console.log(chalk.bold('Summary:'));
  console.log(`  Total assignments: ${total}`);
  console.log(`  ${chalk.yellow('In progress')}: ${inProgress}`);
  console.log(`  ${chalk.blue('LLM complete')}: ${completed}`);
  console.log(`  ${chalk.green('Merged')}: ${merged}`);
  console.log();

  // Display each status group
  if (byStatus['in-progress'].length > 0) {
    console.log(chalk.yellow.bold('⏳ In Progress:\n'));
    byStatus['in-progress'].forEach((assignment) => {
      displayAssignment(assignment);
    });
  }

  if (byStatus.assigned.length > 0) {
    console.log(chalk.blue.bold('📋 Assigned:\n'));
    byStatus.assigned.forEach((assignment) => {
      displayAssignment(assignment);
    });
  }

  if (byStatus['llm-complete'].length > 0) {
    console.log(chalk.cyan.bold('✅ LLM Complete (Awaiting Review):\n'));
    byStatus['llm-complete'].forEach((assignment) => {
      displayAssignment(assignment);
    });
  }

  if (byStatus.merged.length > 0) {
    console.log(chalk.green.bold('🎉 Merged:\n'));
    byStatus.merged.forEach((assignment) => {
      displayAssignment(assignment);
    });
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

function getStatusIcon(status: AssignmentStatus): string {
  switch (status) {
    case 'assigned':
      return '📌';
    case 'in-progress':
      return '🔄';
    case 'llm-complete':
      return '✅';
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
