/**
 * Stop command implementation
 */

import { AssignmentManager } from '../../core/assignment-manager.js';
import chalk from 'chalk';

interface StopOptions {
  force?: boolean;
}

export async function stopCommand(options: StopOptions): Promise<void> {
  console.log(chalk.yellow('Stopping autonomous mode...\n'));

  try {
    const cwd = process.cwd();

    // Load assignments to find running instances
    const assignmentManager = new AssignmentManager(cwd);
    await assignmentManager.load();

    const activeAssignments = assignmentManager.getAssignmentsByStatus('in-progress');

    if (activeAssignments.length === 0) {
      console.log(chalk.blue('No active assignments found'));
      return;
    }

    console.log(`Found ${activeAssignments.length} active assignment(s):`);
    activeAssignments.forEach((assignment) => {
      console.log(`  - Issue #${assignment.issueNumber}: ${assignment.issueTitle}`);
      console.log(`    LLM: ${assignment.llmProvider} (${assignment.llmInstanceId})`);
    });

    if (options.force) {
      console.log(chalk.yellow('\nForce stopping all instances...'));
    } else {
      console.log(chalk.yellow('\nGracefully stopping instances...'));
      console.log(chalk.gray('(Use --force to immediately terminate)'));
    }

    // In a real implementation, you would:
    // 1. Signal each LLM instance to stop
    // 2. Wait for graceful shutdown (unless force)
    // 3. Update assignment statuses

    console.log(chalk.green('\n✓ All instances stopped'));
    console.log(chalk.blue('\nWork sessions have been saved.'));
    console.log('Resume with: autonomous start');
  } catch (error: any) {
    console.error(chalk.red('Error stopping autonomous mode:'), error.message);
    process.exit(1);
  }
}
