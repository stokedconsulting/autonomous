/**
 * Config command implementations
 */

import { ConfigManager } from '../../core/config-manager.js';
import { LLMProvider, LLMConfig } from '../../types/index.js';
import { parseGitHubRemote } from '../../git/utils.js';
import { DependencyChecker } from '../../utils/dependency-checker.js';
import chalk from 'chalk';
import { parseLLMProvider } from '../../utils/llm-provider.js';
import { resolveCliArgs, resolveCliPath, resolveHooksEnabled } from '../../llm/cli-defaults.js';

interface InitOptions {
  githubOwner?: string;
  githubRepo?: string;
  project?: boolean; // Commander converts --no-project to project: false
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
    const isNewConfig = !exists;

    if (exists) {
      console.log(chalk.blue('Configuration exists - verifying setup...\n'));
      await configManager.initialize();
    } else {
      console.log(chalk.blue('Initializing auto configuration...\n'));
    }

    // Auto-detect GitHub owner/repo from git remote if not provided
    let { githubOwner, githubRepo } = options;

    if (isNewConfig) {
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
        console.log('  auto config set github.owner <owner>');
        console.log('  auto config set github.repo <repo>');
      } else {
        console.log(chalk.green(`\n✓ GitHub repository: ${githubOwner}/${githubRepo}`));
      }
    } else {
      // For existing config, get owner/repo from config
      const config = configManager.getConfig();
      githubOwner = githubOwner || config.github.owner;
      githubRepo = githubRepo || config.github.repo;

      if (githubOwner && githubRepo) {
        console.log(chalk.green(`✓ GitHub repository: ${githubOwner}/${githubRepo}`));
      }
    }

    // Check dependencies (only for new configs)
    if (isNewConfig) {
      console.log(chalk.blue('\n📦 Checking dependencies...'));
      const depChecker = new DependencyChecker(cwd);
      const dependencies = await depChecker.checkAll();

      const missingRequired = dependencies.filter((d) => d.required && !d.installed);
      const hasChangesetDir = dependencies.find((d) => d.name === '@changesets/cli');

      if (missingRequired.length > 0) {
        console.log(chalk.yellow('\n⚠️  Warning: Missing required dependencies'));
        console.log(chalk.gray('Run: auto setup'));
      }

      if (hasChangesetDir && !hasChangesetDir.installed) {
        console.log(chalk.yellow('\n💡 Tip: Install changesets for push command:'));
        console.log(chalk.gray('  pnpm add -D @changesets/cli && pnpm changeset init'));
        console.log(chalk.gray('  Or run: auto setup'));
      }
    }

    // Setup project integration
    await configManager.initialize();
    const config = configManager.getConfig();

    if (options.project !== false && githubOwner && githubRepo) {
      console.log(chalk.blue('\n📊 Setting up GitHub Project integration...'));

      try {
        const { resolveProjectId } = await import('../../github/project-resolver.js');
        const projectId = await resolveProjectId(githubOwner, githubRepo, false);

        if (projectId) {
          // For new configs or configs without project integration, enable it
          if (isNewConfig || !config.project?.enabled) {
            console.log(chalk.green('✓ Found project - enabling integration'));

            // Add project configuration with sensible defaults
            config.project = {
              enabled: true,
              projectNumber: 0, // Will be resolved dynamically
              organizationProject: true, // Assume org project (can be overridden)
              fields: {
                status: {
                  fieldName: 'Status',
                  readyValues: ['Todo', 'Ready', 'Evaluated', 'Failed Review'],
                  inProgressValue: 'In Progress',
                  reviewValue: 'In Review',
                  doneValue: 'Done',
                  blockedValue: 'Blocked',
                  evaluatedValue: 'Evaluated',
                  needsMoreInfoValue: 'Needs More Info',
                },
                priority: {
                  fieldName: 'Priority',
                  values: {
                    '🔴 Critical': { weight: 10 },
                    '🟠 High': { weight: 7 },
                    '🟡 Medium': { weight: 5 },
                    '🟢 Low': { weight: 3 },
                  },
                },
                size: {
                  fieldName: 'Size',
                  preferredSizes: ['S', 'M'],
                },
                assignedInstance: {
                  fieldName: 'Assigned Instance',
                },
              },
            };

            await configManager.save();
            console.log(chalk.green('✓ Project integration enabled'));
          } else {
            console.log(chalk.green('✓ Project integration already enabled'));
          }

          // Always try to create/ensure Autonomous view exists
          const { GitHubProjectsAPI } = await import('../../github/projects-api.js');
          const projectsAPI = new GitHubProjectsAPI(projectId, config.project);

          // Pass Claude config for browser automation
          const claudeConfig = config.llms?.claude?.enabled ? {
            cliPath: config.llms.claude.cliPath || 'claude',
            cliArgs: config.llms.claude.cliArgs,
          } : undefined;

          await projectsAPI.ensureAutonomousView(claudeConfig);
        } else {
          console.log(chalk.gray('  No project found - using label-based workflow'));
          if (isNewConfig) {
            console.log(chalk.dim('  (Create a project later and run: auto init)'));
          }
        }
      } catch (error) {
        console.log(chalk.yellow('⚠️  Could not setup project integration'));
        if (error instanceof Error) {
          console.log(chalk.gray(`   ${error.message}`));
        }
        console.log(chalk.gray('  Falling back to label-based workflow'));
      }
    } else if (options.project === false) {
      console.log(chalk.gray('\n  Project integration disabled (--no-project)'));
    }

    console.log(chalk.blue('\nNext steps:'));
    console.log('1. Check/install dependencies:');
    console.log('   auto setup');
    console.log('2. Configure an LLM provider (if not auto-configured):');
    console.log('   auto config add-llm claude --cli-path /path/to/claude');
    console.log('3. Start autonomous mode:');
    console.log('   auto start');
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
    const parsedProvider = parseLLMProvider(provider);
    if (!parsedProvider) {
      console.error(chalk.red(`Invalid provider: ${provider}`));
      console.log('Valid providers: claude, gemini, codex');
      process.exit(1);
    }

    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);

    // Load existing config
    await configManager.initialize();

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
    await configManager.enableLLM(parsedProvider, updateConfig);

    console.log(chalk.green(`✓ ${parsedProvider} enabled`));

    if (parsedProvider === 'claude' && !options.cliPath) {
      console.log(chalk.yellow('\nNote: Using default CLI path "claude"'));
      console.log('If Claude is installed elsewhere, set the path with:');
      console.log(`  auto config set llms.${parsedProvider}.cliPath <path>`);
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
 * Enable a single LLM provider and disable others
 */
async function useLLM(provider: string, options: AddLLMOptions): Promise<void> {
  try {
    const parsedProvider = parseLLMProvider(provider);
    if (!parsedProvider) {
      console.error(chalk.red(`Invalid provider: ${provider}`));
      console.log('Valid providers: claude, gemini, codex');
      process.exit(1);
    }

    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);

    await configManager.initialize();
    const config = configManager.getConfig();

    const cliArgs = options.cliArgs
      ? options.cliArgs.split(' ').filter(arg => arg.length > 0)
      : undefined;

    // Disable all other providers
    for (const providerKey of Object.keys(config.llms) as LLMProvider[]) {
      config.llms[providerKey].enabled = providerKey === parsedProvider;
    }

    const providerConfig = config.llms[parsedProvider];

    providerConfig.cliPath = options.cliPath
      ? options.cliPath
      : resolveCliPath(parsedProvider, providerConfig.cliPath);
    providerConfig.cliArgs = cliArgs
      ? cliArgs
      : resolveCliArgs(parsedProvider, providerConfig.cliArgs);
    providerConfig.hooksEnabled = options.enableHooks !== undefined
      ? options.enableHooks
      : resolveHooksEnabled(parsedProvider, providerConfig.hooksEnabled);

    if (options.maxConcurrent) {
      providerConfig.maxConcurrentIssues = options.maxConcurrent;
    }

    if (options.apiKey) {
      providerConfig.apiKey = options.apiKey;
    }

    await configManager.save();

    console.log(chalk.green(`✓ Using ${parsedProvider} as the active provider`));
  } catch (error) {
    console.error(chalk.red('Error updating LLM provider:'), error);
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

    await configManager.initialize();
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

    await configManager.initialize();
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
  useLLM,
  show,
  validate,
};
