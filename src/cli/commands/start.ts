/**
 * Start command implementation
 */

import { ConfigManager } from '../../core/config-manager.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { Orchestrator } from '../../core/orchestrator.js';
import chalk from 'chalk';
import { basename } from 'path';

interface StartOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  console.log(chalk.blue.bold('\n🚀 Starting Autonomous Mode\n'));

  try {
    const cwd = process.cwd();
    const projectName = basename(cwd);

    // Load configuration
    console.log('Loading configuration...');
    const configManager = new ConfigManager(cwd);
    await configManager.load();

    // Validate configuration
    const validation = configManager.validate();
    if (!validation.valid) {
      console.log(chalk.red('\n✗ Configuration is invalid:\n'));
      validation.errors.forEach((error) => {
        console.log(chalk.red(`  - ${error}`));
      });
      console.log(chalk.yellow('\nRun "autonomous config validate" for more details'));
      process.exit(1);
    }

    console.log(chalk.green('✓ Configuration loaded'));

    // Initialize assignment manager
    console.log('Initializing assignment tracking...');
    const assignmentManager = new AssignmentManager(cwd);
    await assignmentManager.initialize(projectName, cwd);
    console.log(chalk.green('✓ Assignment tracking initialized'));

    // Initialize orchestrator
    console.log('Starting orchestrator...');
    const orchestrator = new Orchestrator(cwd, configManager, assignmentManager);
    await orchestrator.initialize();

    if (options.dryRun) {
      console.log(chalk.yellow('\n🔍 Dry run mode - simulating without starting LLMs\n'));
      await orchestrator.dryRun();
      console.log(chalk.green('\n✓ Dry run completed'));
      return;
    }

    // Start the orchestrator
    await orchestrator.start();

    console.log(chalk.green('\n✓ Autonomous mode started'));
    console.log(chalk.blue('\nOrchestrator is now running...'));
    console.log('Press Ctrl+C to stop\n');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\nStopping autonomous mode...'));
      await orchestrator.stop();
      console.log(chalk.green('✓ Stopped'));
      process.exit(0);
    });

    // Keep the process running
    await new Promise(() => {}); // Infinite promise
  } catch (error: any) {
    console.error(chalk.red('\n✗ Error starting autonomous mode:'), error.message);
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}
