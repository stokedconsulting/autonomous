/**
 * Config command implementations
 */

import { ConfigManager } from '../../core/config-manager.js';
import { LLMProvider, LLMConfig } from '../../types/index.js';
import { parseGitHubRemote } from '../../git/utils.js';
import { DependencyChecker } from '../../utils/dependency-checker.js';
import chalk from 'chalk';

interface InitOptions {
  githubOwner?: string;
  githubRepo?: string;
  interactive?: boolean;
}

interface AddLLMOptions {
  cliPath?: string;
  cliArgs?: string;
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

    // Auto-detect GitHub owner/repo from git remote if not provided
    let { githubOwner, githubRepo } = options;

    if (!githubOwner || !githubRepo) {
      console.log('Detecting GitHub repository from git remote...');
      const remoteInfo = await parseGitHubRemote(cwd);

      if (remoteInfo) {
        githubOwner = githubOwner || remoteInfo.owner;
        githubRepo = githubRepo || remoteInfo.repo;
        console.log(chalk.green(`✓ Detected: ${githubOwner}/${githubRepo}\n`));
      } else {
        console.log(chalk.yellow('Could not detect GitHub repository from git remote.\n'));
      }
    }

    // Initialize with provided or detected options
    await configManager.initialize(githubOwner, githubRepo);

    console.log(chalk.green('✓ Configuration created: .autonomous-config.json'));

    if (!githubOwner || !githubRepo) {
      console.log(chalk.yellow('\nWarning: GitHub owner/repo not set.'));
      console.log('Set them with:');
      console.log('  autonomous config set github.owner <owner>');
      console.log('  autonomous config set github.repo <repo>');
    } else {
      console.log(chalk.green(`\n✓ GitHub repository: ${githubOwner}/${githubRepo}`));
    }

    // Check dependencies
    console.log(chalk.blue('\n📦 Checking dependencies...'));
    const depChecker = new DependencyChecker(cwd);
    const dependencies = await depChecker.checkAll();

    const missingRequired = dependencies.filter((d) => d.required && !d.installed);
    const hasChangesetDir = dependencies.find((d) => d.name === '@changesets/cli');

    if (missingRequired.length > 0) {
      console.log(chalk.yellow('\n⚠️  Warning: Missing required dependencies'));
      console.log(chalk.gray('Run: autonomous setup'));
    }

    if (hasChangesetDir && !hasChangesetDir.installed) {
      console.log(chalk.yellow('\n💡 Tip: Install changesets for push command:'));
      console.log(chalk.gray('  pnpm add -D @changesets/cli && pnpm changeset init'));
      console.log(chalk.gray('  Or run: autonomous setup'));
    }

    // Create Autonomous view if project integration is enabled
    await configManager.load();
    const config = configManager.getConfig();

    if (config.project?.enabled && githubOwner && githubRepo) {
      console.log(chalk.blue('\n📊 Setting up GitHub Project...'));

      try {
        const { resolveProjectId } = await import('../../github/project-resolver.js');
        const projectId = await resolveProjectId(githubOwner, githubRepo, false);

        if (projectId) {
          const { GitHubProjectsAPI } = await import('../../github/projects-api.js');
          const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
          await projectsAPI.ensureAutonomousView();
          console.log(chalk.green('✓ GitHub Project view configured'));
        } else {
          console.log(chalk.yellow('⚠️  No GitHub Project found - skipping view creation'));
          console.log(chalk.gray('   Create a project first, then run: autonomous evaluate'));
        }
      } catch (error) {
        console.log(chalk.yellow('⚠️  Could not create project view (you can do this later)'));
        if (error instanceof Error) {
          console.log(chalk.gray(`   ${error.message}`));
        }
      }
    }

    console.log(chalk.blue('\nNext steps:'));
    console.log('1. Check/install dependencies:');
    console.log('   autonomous setup');
    console.log('2. Configure an LLM provider (if not auto-configured):');
    console.log('   autonomous config add-llm claude --cli-path /path/to/claude');
    console.log('3. Start autonomous mode:');
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

    // Parse CLI args if provided (space-separated string to array)
    const cliArgs = options.cliArgs
      ? options.cliArgs.split(' ').filter(arg => arg.length > 0)
      : undefined;

    // Build update object, only including fields that were explicitly provided
    const updateConfig: Partial<LLMConfig> = {};
    if (options.cliPath) updateConfig.cliPath = options.cliPath;
    if (cliArgs) updateConfig.cliArgs = cliArgs;
    if (options.apiKey) updateConfig.apiKey = options.apiKey;
    if (options.maxConcurrent) updateConfig.maxConcurrentIssues = options.maxConcurrent;
    if (options.enableHooks !== undefined) updateConfig.hooksEnabled = options.enableHooks;

    // Enable the LLM with provided options
    await configManager.enableLLM(provider as LLMProvider, updateConfig);

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
          if (llmConfig.cliArgs && llmConfig.cliArgs.length > 0) {
            console.log(`    CLI args: ${llmConfig.cliArgs.join(' ')}`);
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
