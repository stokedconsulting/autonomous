/**
 * Config command implementations
 */

import { ConfigManager } from '../../core/config-manager.js';
import { LLMProvider } from '../../types/index.js';
import chalk from 'chalk';

interface InitOptions {
  githubOwner?: string;
  githubRepo?: string;
  interactive?: boolean;
}

interface AddLLMOptions {
  cliPath?: string;
  apiKey?: string;
  maxConcurrent?: number;
  enableHooks?: boolean;
}

interface ShowOptions {
  json?: boolean;
}

/**
 * Initialize configuration
 */
async function init(options: InitOptions): Promise<void> {
  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);

    // Check if config already exists
    const exists = await configManager.exists();
    if (exists) {
      console.log(chalk.yellow('Configuration already exists. Use config commands to modify it.'));
      return;
    }

    console.log(chalk.blue('Initializing autonomous configuration...\n'));

    // Initialize with provided options
    await configManager.initialize(options.githubOwner, options.githubRepo);

    console.log(chalk.green('✓ Configuration created: .autonomous-config.json'));

    if (!options.githubOwner || !options.githubRepo) {
      console.log(chalk.yellow('\nWarning: GitHub owner/repo not set.'));
      console.log('Set them with:');
      console.log('  autonomous config set github.owner <owner>');
      console.log('  autonomous config set github.repo <repo>');
    }

    console.log(chalk.blue('\nNext steps:'));
    console.log('1. Configure an LLM provider:');
    console.log('   autonomous config add-llm claude --cli-path /path/to/claude');
    console.log('2. Start autonomous mode:');
    console.log('   autonomous start');
  } catch (error) {
    console.error(chalk.red('Error initializing configuration:'), error);
    process.exit(1);
  }
}

/**
 * Add LLM provider
 */
async function addLLM(provider: string, options: AddLLMOptions): Promise<void> {
  try {
    // Validate provider
    const validProviders: LLMProvider[] = ['claude', 'gemini', 'codex'];
    if (!validProviders.includes(provider as LLMProvider)) {
      console.error(chalk.red(`Invalid provider: ${provider}`));
      console.log('Valid providers:', validProviders.join(', '));
      process.exit(1);
    }

    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);

    // Load existing config
    await configManager.load();

    // Enable the LLM with provided options
    await configManager.enableLLM(provider as LLMProvider, {
      cliPath: options.cliPath,
      apiKey: options.apiKey,
      maxConcurrentIssues: options.maxConcurrent || 1,
      hooksEnabled: options.enableHooks || false,
    });

    console.log(chalk.green(`✓ ${provider} enabled`));

    if (provider === 'claude' && !options.cliPath) {
      console.log(chalk.yellow('\nNote: Using default CLI path "claude"'));
      console.log('If Claude is installed elsewhere, set the path with:');
      console.log(`  autonomous config set llms.${provider}.cliPath <path>`);
    }

    // Validate configuration
    const validation = configManager.validate();
    if (!validation.valid) {
      console.log(chalk.yellow('\nConfiguration warnings:'));
      validation.errors.forEach((error) => {
        console.log(chalk.yellow(`- ${error}`));
      });
    }
  } catch (error) {
    console.error(chalk.red('Error adding LLM provider:'), error);
    process.exit(1);
  }
}

/**
 * Show configuration
 */
async function show(options: ShowOptions): Promise<void> {
  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);

    await configManager.load();
    const config = configManager.getConfig();

    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log(chalk.blue('Autonomous Configuration\n'));

      console.log(chalk.bold('GitHub:'));
      console.log(`  Owner: ${config.github.owner || chalk.gray('not set')}`);
      console.log(`  Repo: ${config.github.repo || chalk.gray('not set')}`);
      console.log(`  Labels: ${config.github.labels?.join(', ') || chalk.gray('none')}`);

      console.log(chalk.bold('\nLLM Providers:'));
      Object.entries(config.llms).forEach(([provider, llmConfig]) => {
        const status = llmConfig.enabled ? chalk.green('enabled') : chalk.gray('disabled');
        console.log(`  ${provider}: ${status}`);
        if (llmConfig.enabled) {
          console.log(`    Max concurrent: ${llmConfig.maxConcurrentIssues}`);
          if (llmConfig.cliPath) {
            console.log(`    CLI path: ${llmConfig.cliPath}`);
          }
          if (llmConfig.hooksEnabled) {
            console.log(`    Hooks: ${chalk.green('enabled')}`);
          }
        }
      });

      console.log(chalk.bold('\nRequirements:'));
      console.log(`  Testing required: ${config.requirements.testingRequired ? 'Yes' : 'No'}`);
      console.log(`  CI must pass: ${config.requirements.ciMustPass ? 'Yes' : 'No'}`);
      console.log(`  PR template required: ${config.requirements.prTemplateRequired ? 'Yes' : 'No'}`);

      console.log(chalk.bold('\nWorktree:'));
      console.log(`  Base directory: ${config.worktree.baseDir}`);
      console.log(`  Naming pattern: ${config.worktree.namingPattern}`);
    }
  } catch (error) {
    console.error(chalk.red('Error showing configuration:'), error);
    process.exit(1);
  }
}

/**
 * Validate configuration
 */
async function validate(): Promise<void> {
  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);

    await configManager.load();
    const validation = configManager.validate();

    if (validation.valid) {
      console.log(chalk.green('✓ Configuration is valid'));
    } else {
      console.log(chalk.red('✗ Configuration has errors:\n'));
      validation.errors.forEach((error) => {
        console.log(chalk.red(`  - ${error}`));
      });
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('Error validating configuration:'), error);
    process.exit(1);
  }
}

export const configCommand = {
  init,
  addLLM,
  show,
  validate,
};
