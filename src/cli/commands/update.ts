/**
 * Update command - Run migrations if needed
 */

import { ConfigManager } from '../../core/config-manager.js';
import { MigrationManager } from '../../migrations/migration-manager.js';
import chalk from 'chalk';

interface UpdateOptions {
  force?: boolean;
  verbose?: boolean;
}

/**
 * Update autonomous system (run migrations if needed)
 */
export async function updateCommand(options: UpdateOptions): Promise<void> {
  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);

    console.log(chalk.blue('Checking for updates...\n'));

    // Initialize will:
    // 1. Find config in either old (.autonomous-config.json) or new (.autonomous/.autonomous-config.json) location
    // 2. Run migrations if needed (including moving files to .autonomous/)
    // 3. Update version in config
    try {
      await configManager.initialize();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Not a git repository')) {
        console.log(chalk.red('✗ Not a git repository'));
        console.log(chalk.gray('Run this command from a git repository root'));
        process.exit(1);
      }

      // No config found
      console.log(chalk.yellow('⚠️  No configuration found'));
      console.log(chalk.gray('Run "auto config init" to create configuration'));
      process.exit(1);
    }

    const updatedConfig = configManager.getConfig();
    const currentVersion = updatedConfig.version || '0.1.0';

    console.log(chalk.gray(`Current version: ${currentVersion}`));
    console.log(chalk.gray(`Target version: ${MigrationManager.getCurrentVersionString()}\n`));

    if (currentVersion === MigrationManager.getCurrentVersionString()) {
      console.log(chalk.green('✓ Already up to date!'));
      console.log(chalk.gray('  No migrations needed'));
      return;
    }

    console.log(chalk.green(`\n✓ Update complete!`));
    console.log(chalk.gray(`  Now on v${currentVersion}`));

    if (options.verbose) {
      console.log(chalk.blue('\nUpdated configuration:'));
      console.log(JSON.stringify(updatedConfig, null, 2));
    }
  } catch (error) {
    console.error(chalk.red('Error running update:'), error);
    if (error instanceof Error) {
      console.error(chalk.gray(error.message));
    }
    process.exit(1);
  }
}
