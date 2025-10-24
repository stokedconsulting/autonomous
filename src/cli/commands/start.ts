/**
 * Start command implementation
 */

import { ConfigManager } from '../../core/config-manager.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { Orchestrator } from '../../core/orchestrator.js';
import { parseGitHubRemote } from '../../git/utils.js';
import { hasGitHubToken } from '../../utils/github-token.js';
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

    // Check if configuration exists, auto-initialize if not
    const configManager = new ConfigManager(cwd);
    const configExists = await configManager.exists();

    if (!configExists) {
      console.log(chalk.blue('First run detected - auto-configuring...\n'));

      // Auto-detect GitHub repository
      console.log('Detecting GitHub repository from git remote...');
      const remoteInfo = await parseGitHubRemote(cwd);

      if (!remoteInfo) {
        console.error(chalk.red('✗ Could not detect GitHub repository from git remote'));
        console.log(chalk.yellow('\nPlease ensure:'));
        console.log('  1. This is a git repository');
        console.log('  2. You have a GitHub remote configured (origin)');
        console.log('\nOr manually initialize with:');
        console.log('  auto config init --github-owner <owner> --github-repo <repo>');
        process.exit(1);
      }

      console.log(chalk.green(`✓ Detected: ${remoteInfo.owner}/${remoteInfo.repo}\n`));

      // Initialize configuration
      console.log('Initializing configuration...');
      await configManager.initialize(remoteInfo.owner, remoteInfo.repo);

      // Auto-configure Claude with hooks enabled
      console.log('Configuring Claude with hooks enabled...');

      // Try to find the actual Claude path (handles shell aliases)
      let claudePath = 'claude';
      try {
        const { $ } = await import('zx');
        const shell = process.env.SHELL || '/bin/bash';
        const result = await $`${shell} -l -c "which claude"`;
        const detectedPath = result.stdout.trim();
        if (detectedPath && !detectedPath.includes('aliased')) {
          claudePath = detectedPath;
        } else if (detectedPath.includes('aliased to ')) {
          // Extract path from alias output like "claude: aliased to /path/to/claude"
          const match = detectedPath.match(/aliased to (.+)/);
          if (match) {
            claudePath = match[1].trim();
          }
        }
      } catch {
        // Keep default 'claude' if detection fails
      }

      await configManager.enableLLM('claude', {
        cliPath: claudePath,
        cliArgs: ['--dangerously-skip-permissions'],
        maxConcurrentIssues: 1,
        hooksEnabled: true,
      });

      console.log(chalk.green('✓ Configuration created and Claude enabled\n'));
      console.log(chalk.blue('Configuration saved to .autonomous-config.json'));
      console.log(chalk.gray('You can customize settings with: auto config show\n'));
    } else {
      // Load existing configuration
      console.log('Loading configuration...');
      await configManager.load();
    }

    // Validate configuration
    const validation = configManager.validate();
    if (!validation.valid) {
      console.log(chalk.red('\n✗ Configuration is invalid:\n'));
      validation.errors.forEach((error) => {
        console.log(chalk.red(`  - ${error}`));
      });
      console.log(chalk.yellow('\nRun "auto config validate" for more details'));
      process.exit(1);
    }

    console.log(chalk.green('✓ Configuration loaded'));

    // Check for GitHub token
    const config = configManager.getConfig();

    if (!hasGitHubToken(config.github.token)) {
      console.error(chalk.red('\n✗ GitHub token not found'));
      console.log(chalk.yellow('\nPlease authenticate with GitHub:'));
      console.log('  gh auth login');
      console.log('\nOr set GITHUB_TOKEN:');
      console.log('  export GITHUB_TOKEN=your_github_token_here');
      console.log('\nCreate a token at: https://github.com/settings/tokens');
      console.log('Required scopes: repo, workflow');
      process.exit(1);
    }

    // Initialize assignment manager
    console.log('Initializing assignment tracking...');
    const assignmentManager = new AssignmentManager(cwd);
    await assignmentManager.initialize(projectName, cwd);
    console.log(chalk.green('✓ Assignment tracking initialized'));

    // Initialize orchestrator
    console.log('Starting orchestrator...');
    const orchestrator = new Orchestrator(cwd, configManager, assignmentManager, options.verbose);
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

    if (options.verbose) {
      console.log(chalk.blue('\n📡 Monitoring Mode - Streaming Claude output...\n'));
      console.log(chalk.gray('─'.repeat(80)));
      console.log();
    } else {
      console.log(chalk.blue('\nOrchestrator is now running...'));
      console.log(chalk.gray('Tip: Use --verbose flag to stream Claude output in real-time'));
      console.log('Press Ctrl+C to stop\n');
    }

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
