import { ConfigManager } from '../../core/config-manager.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { ProjectFieldMapper } from '../../github/project-field-mapper.js';
import { IssueEvaluator } from '../../core/issue-evaluator.js';
import { ProjectAwarePrioritizer } from '../../core/project-aware-prioritizer.js';
import { getGitHubToken } from '../../utils/github-token.js';
import { resolveProjectId } from '../../github/project-resolver.js';
// import { Issue } from '../../types/github.js'; // Removed as unused
import { IssueEvaluation } from '../../types/evaluation.js';
import { ProjectConfig } from '../../types/config.js';
import chalk from 'chalk';
import { GitHubAPI } from '../../github/api.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { ProjectField, ProjectFieldOption } from '../../github/projects-api.js';
import { Assignment, LLMProvider } from '../../types/assignments.js';
import { PrioritizedIssue } from '../../core/project-aware-prioritizer.js';
import { ProjectDiscovery, DiscoveredProject } from '../../github/project-discovery.js';
import { WorktreeManager } from '../../git/worktree-manager.js';
import { LLMFactory } from '../../llm/llm-factory.js';
import { PromptBuilder } from '../../llm/prompt-builder.js';
import { InstanceManager, InstanceSlot } from '../../core/instance-manager.js';
import { resolveLLMProvider } from '../../utils/llm-provider.js';
import { join } from 'path';
import { promises as fs } from 'fs';
import { basename } from 'path';
import { detectSessionCompletion, extractPRNumber, detectAutonomousSignals } from '../../utils/session-analyzer.js';
import { getLatestFailedReviewFeedback } from '../../utils/review-feedback.js';
import {
  generateProjectPlan,
  refineProjectPlan,
  parseProjectPlan,
  createProjectIssues
} from '../../services/project-creation.js';
import { renderProjectCreation } from '../../ui/apps/index.js';

function hasStderr(error: unknown): error is { stderr: string } {
  return typeof error === 'object' && error !== null && 'stderr' in error;
}

interface ProjectCommandOptions {
  verbose?: boolean;
  limit?: number;
  all?: boolean;
}

export async function projectInitCommand(_options: ProjectCommandOptions): Promise<void> {
  console.log(chalk.blue.bold('\n🚀 Autonomous Project Init\n'));

  try {
    const cwd = process.cwd();
    const _configManager = new ConfigManager(cwd);
    await _configManager.initialize();
    const config = _configManager.getConfig();

    if (!config.github.owner || !config.github.repo) {
      console.error(chalk.red('Error: GitHub owner and repo not configured.'));
      console.error(chalk.red('Please run `auto config set github.owner <owner>` and `auto config set github.repo <repo>`'));
      process.exit(1);
    }

    const _githubToken = await getGitHubToken(config.github.token);
    if (!_githubToken) {
      console.error(chalk.red('Error: GitHub token not found.'));
      console.error(chalk.red('Please run `auto config set github.token <token>` or set GITHUB_TOKEN environment variable.'));
      process.exit(1);
    }

    console.log(chalk.blue('Resolving GitHub Project ID...'));
    const projectId = await resolveProjectId(config.github.owner, config.github.repo, true);

    if (!projectId) {
      console.error(chalk.red('Error: Could not resolve GitHub Project ID.'));
      process.exit(1);
    }

    // Ensure project config is set (projects are discovered from assignments, not configured here)
    if (!config.project) {
      config.project = {
        enabled: true,
        organizationProject: false, // Default to false, can be updated later.
        validated: [], // Track which projects have been validated
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
            values: {},
          },
          size: { fieldName: 'Size' },
          sprint: { fieldName: 'Iteration' },
          assignedInstance: { fieldName: 'Assigned Instance' },
        },
      };
    } else {
      config.project.enabled = true;
      // Projects are now discovered from assignments, not configured in config
      if (!config.project.validated) {
        config.project.validated = [];
      }
    }

    // When project integration is enabled, clear label filters
    // Project status (Todo/Ready/Evaluated) is the filter, not labels
    if (config.github.labels && config.github.labels.length > 0) {
      console.log(chalk.yellow('\n⚠️  Project integration enabled - clearing label filters'));
      console.log(chalk.gray('   Project status is now the filter (Todo, Ready, Evaluated)'));
      console.log(chalk.gray(`   Removed labels: ${config.github.labels.join(', ')}`));
      config.github.labels = [];
    }

    await _configManager.save();

    // Initialize Projects API and ensure view exists
    const projectsAPI = new GitHubProjectsAPI(projectId, config.project as ProjectConfig);
    const claudeConfig = config.llms?.claude?.enabled ? {
      cliPath: config.llms.claude.cliPath || 'claude',
      cliArgs: config.llms.claude.cliArgs,
    } : undefined;
    await projectsAPI.ensureAutonomousView(claudeConfig);

    console.log(chalk.green('\n✓ GitHub Project integration initialized!'));
    console.log(chalk.gray('  1. Run "auto start" to begin autonomous work'));
    console.log(chalk.gray('  2. Run "auto project status" to see project status'));
    console.log(chalk.gray('  3. Run "auto project list-ready" to see ready items'));
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error initializing project:'), error instanceof Error ? error.message : String(error));
    if (hasStderr(error) && error.stderr) {
      console.error(chalk.gray(hasStderr(error) ? error.stderr : 'Unknown error'));
    }
    process.exit(1);
  }
}

export async function projectStatusCommand(_options: ProjectCommandOptions): Promise<void> {
  console.log(chalk.blue.bold('\n📊 Autonomous Project Status\n'));

  try {
    const cwd = process.cwd();
    const _configManager = new ConfigManager(cwd);
    await _configManager.initialize();
    const config = _configManager.getConfig();

    if (!config.project?.enabled) {
      console.error(chalk.red('Error: GitHub Project integration not enabled.'));
      console.error(chalk.red('Please run `auto project init` first.'));
      process.exit(1);
    }

    // Resolve project ID from repository
    const { resolveProjectId } = await import('../../github/project-resolver.js');
    const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
    if (!projectId) {
      console.error(chalk.red('Error: Could not resolve GitHub Project ID.'));
      process.exit(1);
    }

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
    const fields = await projectsAPI.getFields();

    console.log(chalk.green(`✓ Connected to GitHub Project`));
    console.log(chalk.blue('\nProject Fields:'));
    fields.forEach((field: ProjectField) => {
      console.log(chalk.gray(`  - ${field.name} (${field.dataType})`));
      if (field.options && field.options.length > 0) {
        field.options.forEach((option: ProjectFieldOption) => {
          console.log(chalk.gray(`    - ${option.name}`));
        });
      }
    });

    console.log(chalk.blue('\nConfigured Status Field:'));
    console.log(chalk.gray(`  Field Name: ${config.project.fields.status.fieldName}`));
    console.log(chalk.gray(`  Ready Values: ${config.project.fields.status.readyValues.join(', ')}`));
    console.log(chalk.gray(`  Evaluated Value: ${config.project.fields.status.evaluatedValue}`));
    console.log(chalk.gray(`  Needs More Info Value: ${config.project.fields.status.needsMoreInfoValue}`));

    console.log(chalk.green('\n✓ Project status retrieved successfully.'));
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error getting project status:'), error instanceof Error ? error.message : String(error));
    if (hasStderr(error) && error.stderr) {
      console.error(chalk.gray(error.stderr));
    }
    process.exit(1);
  }
}

export async function projectSyncLabelsCommand(options: ProjectCommandOptions): Promise<void> {
  console.log(chalk.blue.bold('\n🔄 Syncing All Issue Metadata to Project Fields\n'));

  try {
    const cwd = process.cwd();
    const _configManager = new ConfigManager(cwd);
    await _configManager.initialize();
    const config = _configManager.getConfig();

    if (!config.project?.enabled) {
      console.error(chalk.red('Error: GitHub Project integration not enabled.'));
      console.error(chalk.red('Please run `auto project init` first.'));
      process.exit(1);
    }

    const _githubToken = await getGitHubToken(config.github.token);
    if (!_githubToken) {
      console.error(chalk.red('Error: GitHub token not found.'));
      console.error(chalk.red('Please run `auto config set github.token <token>` or set GITHUB_TOKEN environment variable.'));
      process.exit(1);
    }

    // Resolve project ID from number
    const { resolveProjectId } = await import('../../github/project-resolver.js');
    const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
    if (!projectId) {
      console.error(chalk.red('Error: Could not resolve GitHub Project ID.'));
      process.exit(1);
    }

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
    const githubAPI = new GitHubAPI(_githubToken, config.github.owner, config.github.repo);

    console.log(chalk.blue('Fetching all open issues...'));

    const issues = await githubAPI.getIssues({
      state: 'open',
    });

    if (issues.length === 0) {
      console.log(chalk.yellow('No open issues found.'));
      return;
    }

    console.log(chalk.blue(`Found ${issues.length} open issues. Syncing metadata to project fields...\n`));

    let syncedCount = 0;
    let errorCount = 0;

    for (const issue of issues) {
      try {
        if (options.verbose) {
          console.log(chalk.cyan(`\n  Issue #${issue.number}: ${issue.title}`));
        }

        // Sync Complexity and Impact from labels
        await projectsAPI.syncIssueLabelsToFields(issue.number, issue.labels);
        if (options.verbose) {
          console.log(chalk.gray('    ✓ Synced Complexity/Impact'));
        }

        // Sync Work Type from labels
        await projectsAPI.syncWorkTypeFromLabels(issue.number, issue.labels);
        if (options.verbose) {
          console.log(chalk.gray('    ✓ Synced Work Type'));
        }

        // Sync Area from labels
        await projectsAPI.syncAreaFromLabels(issue.number, issue.labels);
        if (options.verbose) {
          console.log(chalk.gray('    ✓ Synced Area'));
        }

        syncedCount++;
        if (!options.verbose) {
          process.stdout.write(chalk.gray('.'));
        }
      } catch (error) {
        errorCount++;
        if (options.verbose) {
          console.log(chalk.yellow(`    ⚠ Failed: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    }

    if (!options.verbose) {
      console.log(''); // New line after dots
    }

    console.log(chalk.green(`\n✓ Synced ${syncedCount} issues successfully`));
    if (errorCount > 0) {
      console.log(chalk.yellow(`  ⚠ ${errorCount} issues had errors (may not be in project)`));
    }

    console.log(chalk.blue('\n📝 Fields synced:'));
    console.log(chalk.gray('  • Complexity (from complexity:* labels)'));
    console.log(chalk.gray('  • Impact (from impact:* labels)'));
    console.log(chalk.gray('  • Work Type (from bug/enhancement/documentation labels)'));
    console.log(chalk.gray('  • Area (from area:* labels)'));
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error syncing fields:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

export async function projectClearAssignmentsCommand(_options: ProjectCommandOptions): Promise<void> {
  console.log(chalk.blue.bold('\n🧹 Clearing Stale Assignments\n'));

  try {
    const cwd = process.cwd();
    const _configManager = new ConfigManager(cwd);
    await _configManager.initialize();
    const config = _configManager.getConfig();

    if (!config.project?.enabled) {
      console.error(chalk.red('Error: GitHub Project integration not enabled.'));
      console.error(chalk.red('Please run `auto project init` first.'));
      process.exit(1);
    }

    // Resolve project ID from number
    const { resolveProjectId } = await import('../../github/project-resolver.js');
    const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
    if (!projectId) {
      console.error(chalk.red('Error: Could not resolve GitHub Project ID.'));
      process.exit(1);
    }

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);

    console.log(chalk.blue('Clearing all "Assigned Instance" values for items with status: Todo, Ready, Evaluated...'));

    const { cleared, errors } = await projectsAPI.clearStaleAssignments();

    if (cleared > 0) {
      console.log(chalk.green(`\n✓ Cleared ${cleared} stale assignment(s)`));
    } else {
      console.log(chalk.gray('\n  No stale assignments found'));
    }

    if (errors > 0) {
      console.log(chalk.yellow(`  ⚠ ${errors} error(s) occurred`));
    }

    console.log(chalk.blue('\n💡 Tip: Items in "Todo", "Ready", or "Evaluated" status should never have an Assigned Instance.'));
    console.log(chalk.gray('   Only items being actively worked on should have this field set.'));
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error clearing assignments:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function projectBackfillCommand(options: ProjectCommandOptions & { status?: string; all?: boolean }): Promise<void> {
  console.log(chalk.blue.bold('\n🔄 Backfilling Project Fields\n'));

  try {
    const cwd = process.cwd();
    const _configManager = new ConfigManager(cwd);
    await _configManager.initialize();
    const config = _configManager.getConfig();

    if (!config.project?.enabled) {
      console.error(chalk.red('Error: GitHub Project integration not enabled.'));
      console.error(chalk.red('Please run `auto project init` first.'));
      process.exit(1);
    }

    const _githubToken = await getGitHubToken(config.github.token);
    if (!_githubToken) {
      console.error(chalk.red('Error: GitHub token not found.'));
      console.error(chalk.red('Please run `auto config set github.token <token>` or set GITHUB_TOKEN environment variable.'));
      process.exit(1);
    }

    // Resolve project ID from number
    const { resolveProjectId } = await import('../../github/project-resolver.js');
    const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
    if (!projectId) {
      console.error(chalk.red('Error: Could not resolve GitHub Project ID.'));
      process.exit(1);
    }

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
    const githubAPI = new GitHubAPI(_githubToken, config.github.owner, config.github.repo);

    // Get items with specified status or all items
    let items;
    if (options.all) {
      console.log(chalk.blue('Fetching ALL items from project...'));
      items = await projectsAPI.getAllItems();
    } else {
      const targetStatus = options.status || 'In Review';
      console.log(chalk.blue(`Fetching items with status: ${targetStatus}...`));
      items = await projectsAPI.getAllItems({
        status: [targetStatus],
      });
    }

    if (items.length === 0) {
      console.log(chalk.yellow('No items found'));
      return;
    }

    console.log(chalk.blue(`Found ${items.length} items. Backfilling metadata...\n`));

    let syncedCount = 0;
    let errorCount = 0;

    for (const item of items) {
      const issueNumber = item.content.number;

      try {
        if (options.verbose) {
          console.log(chalk.cyan(`\n  Issue #${issueNumber}: ${item.content.title}`));
        }

        // Fetch the issue to get labels
        const issue = await githubAPI.getIssue(issueNumber);

        // Sync Complexity and Impact from labels
        await projectsAPI.syncIssueLabelsToFields(issueNumber, issue.labels);
        if (options.verbose) {
          console.log(chalk.gray('    ✓ Synced Complexity/Impact from labels'));
        }

        // Sync Work Type from labels
        await projectsAPI.syncWorkTypeFromLabels(issueNumber, issue.labels);
        if (options.verbose) {
          console.log(chalk.gray('    ✓ Synced Work Type'));
        }

        // Sync Area from labels
        await projectsAPI.syncAreaFromLabels(issueNumber, issue.labels);
        if (options.verbose) {
          console.log(chalk.gray('    ✓ Synced Area'));
        }

        syncedCount++;
        if (!options.verbose) {
          process.stdout.write(chalk.gray('.'));
        }
      } catch (error) {
        errorCount++;
        if (options.verbose) {
          console.log(chalk.yellow(`    ⚠ Failed: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    }

    if (!options.verbose) {
      console.log(''); // New line after dots
    }

    console.log(chalk.green(`\n✓ Backfilled ${syncedCount} issues successfully`));
    if (errorCount > 0) {
      console.log(chalk.yellow(`  ⚠ ${errorCount} issues had errors`));
    }

    console.log(chalk.blue('\n📝 Fields backfilled:'));
    console.log(chalk.gray('  • Complexity (from complexity:* labels)'));
    console.log(chalk.gray('  • Impact (from impact:* labels)'));
    console.log(chalk.gray('  • Work Type (from bug/enhancement/documentation labels)'));
    console.log(chalk.gray('  • Area (from area:* labels)'));
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error backfilling fields:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

export async function projectListReadyCommand(options: ProjectCommandOptions): Promise<void> {
  console.log(chalk.blue.bold('\n📋 Autonomous Project Ready Items\n'));

  try {
    const cwd = process.cwd();
    const _configManager = new ConfigManager(cwd);
    await _configManager.initialize();
    const config = _configManager.getConfig();

    if (!config.project?.enabled) {
      console.error(chalk.red('Error: GitHub Project integration not enabled.'));
      console.error(chalk.red('Please run `auto project init` first.'));
      process.exit(1);
    }

    const _githubToken = await getGitHubToken(config.github.token);
    if (!_githubToken) {
      console.error(chalk.red('Error: GitHub token not found.'));
      console.error(chalk.red('Please run `auto config set github.token <token>` or set GITHUB_TOKEN environment variable.'));
      process.exit(1);
    }

    // Resolve project ID from number
    const { resolveProjectId } = await import('../../github/project-resolver.js');
    const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
    if (!projectId) {
      console.error(chalk.red('Error: Could not resolve GitHub Project ID.'));
      process.exit(1);
    }

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
    const githubAPI = new GitHubAPI(_githubToken, config.github.owner, config.github.repo);
    const issueEvaluator = new IssueEvaluator(config.llms?.claude?.cliPath || 'claude', githubAPI);
    const fieldMapper = new ProjectFieldMapper(projectsAPI, config.project);
    const prioritizer = new ProjectAwarePrioritizer(config.project, fieldMapper);
    const assignmentManager = new AssignmentManager(cwd);
    await assignmentManager.initialize(config.github.owner, cwd);

    console.log(chalk.blue('Fetching and evaluating issues...'));

    const issues = await githubAPI.getIssues({
      state: 'open',
      labels: config.github.labels,
    });

    if (issues.length === 0) {
      console.log(chalk.yellow('No open issues found with configured labels.'));
      return;
    }

    const { evaluated, skipped } = await issueEvaluator.evaluateIssues(issues, {
      verbose: options.verbose,
      postClarificationComments: false, // Don't spam comments on list command
    });

    if (evaluated.length === 0) {
      console.log(chalk.yellow('No issues have enough detail for autonomous implementation.'));
      if (skipped.length > 0) {
        console.log(chalk.yellow(`  ${skipped.length} issues skipped due to insufficient detail.`));
      }
      return;
    }

    console.log(chalk.blue('Calculating hybrid priorities (AI + Project)...'));

    const issueNumbers = evaluated.map((e: IssueEvaluation) => e.issueNumber);
    const metadataMap = await fieldMapper.getMetadataForIssues(issueNumbers);

    // Filter out issues that are already assigned
    const allAssignments = await assignmentManager.getAllAssignments();
    const assignedIssueNumbers = new Set(allAssignments.map((a: Assignment) => a.issueNumber));

    const assignableEvaluations = evaluated.filter((e: IssueEvaluation) => !assignedIssueNumbers.has(e.issueNumber));

    if (assignableEvaluations.length === 0) {
      console.log(chalk.yellow('All evaluated issues are currently assigned.'));
      return;
    }

    const prioritized = prioritizer.prioritizeIssues(assignableEvaluations, metadataMap);

    const limit = options.limit || prioritized.length;
    const displayItems = prioritized.slice(0, limit);

    console.log(chalk.green(`\nTop ${displayItems.length} Ready Items:`));
    displayItems.forEach((item: PrioritizedIssue, idx: number) => {
      const ctx = item.context;
      console.log(
        chalk.cyan(
          `  ${idx + 1}. #${item.issueNumber} (Hybrid: ${item.hybridScore.toFixed(2)}) - ${ctx.projectPriority || 'No Priority'} - ${ctx.projectSize || 'No Size'}`
        )
      );
      console.log(chalk.gray(`     ${item.issueTitle}`));
      if (options.verbose) {
        console.log(
          chalk.gray(
            `     AI: ${ctx.aiPriorityScore.toFixed(1)} | Project: ${ctx.projectPriority || 'N/A'} | Sprint: ${ctx.projectSprint?.title || 'N/A'}`
          )
        );
      }
    });

    if (options.verbose && displayItems.length > 0) {
      console.log(chalk.blue('\nPrioritization Breakdown (for top item):\n'));
      console.log(prioritizer.getPrioritizationBreakdown(displayItems[0].context));
    }
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error listing ready items:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * List all GitHub Projects linked to this repository
 */
export async function projectListCommand(options: ProjectCommandOptions): Promise<void> {
  console.log(chalk.blue.bold('\n📋 GitHub Projects Linked to Repository\n'));

  try {
    const cwd = process.cwd();
    const _configManager = new ConfigManager(cwd);
    await _configManager.initialize();
    const config = _configManager.getConfig();

    if (!config.github.owner || !config.github.repo) {
      console.error(chalk.red('Error: GitHub owner and repo not configured.'));
      console.error(chalk.red('Please run `auto config init` first.'));
      process.exit(1);
    }

    const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
    const projects = await discovery.getLinkedProjects();

    if (projects.length === 0) {
      console.log(chalk.yellow('No projects linked to this repository.'));
      console.log(chalk.gray('\nTo link a project:'));
      console.log(chalk.gray('  1. Go to your repository on GitHub'));
      console.log(chalk.gray('  2. Click on the "Projects" tab'));
      console.log(chalk.gray('  3. Click "Link a project"'));
      return;
    }

    // Filter out [Done] projects unless --all flag is provided
    const filteredProjects = options.all 
      ? projects 
      : projects.filter(p => !p.title.includes('[Done]'));

    // Show validated projects (multi-project support)
    const validatedProjectNumbers = new Set(
      (config.project?.validated || []).map(p => p.projectNumber)
    );

    const totalCount = projects.length;
    const displayCount = filteredProjects.length;
    const hiddenCount = totalCount - displayCount;

    console.log(chalk.gray(`Found ${displayCount} project(s)${hiddenCount > 0 ? ` (${hiddenCount} done projects hidden, use --all to show)` : ''}:\n`));

    for (const project of filteredProjects) {
      const isValidated = validatedProjectNumbers.has(project.number);
      const prefix = isValidated ? chalk.green('✓ ') : '  ';
      const suffix = isValidated ? chalk.gray(' (validated)') : '';

      console.log(`${prefix}${chalk.cyan(`#${project.number}`)} ${chalk.white(project.title)}${suffix}`);
      console.log(chalk.gray(`     ${project.url}`));
      console.log('');
    }

    if (validatedProjectNumbers.size > 0) {
      console.log(chalk.gray(`\n✓ ${validatedProjectNumbers.size} project(s) have been validated and set up.`));
    } else {
      console.log(chalk.yellow('\nNo projects have been validated yet.'));
      console.log(chalk.gray('Projects will be automatically validated when you start working on them.'));
    }
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error listing projects:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

interface ProjectStartOptions extends ProjectCommandOptions {
  item?: number;
  dryRun?: boolean;
  review?: boolean;
  interactive?: boolean;  // Force Ink UI (default)
  maxParallel?: number;   // Max parallel evaluations (default: 1)
  provider?: string;
  ui?: boolean;           // Disable UI when false (--no-ui)
}

// Track running project processes (in-memory for single process enforcement)
const runningProjects = new Map<string, { pid: number; worktreePath: string; instanceId: string }>();

/**
 * Start autonomous work on a specific GitHub Project
 * Creates feature branch and worktree if needed, then starts the selected LLM on project items
 *
 * With --review flag: Creates a new project from description, allows review, then starts work
 * Ink UI runs by default when the terminal is interactive (use --no-ui to disable)
 */
export async function projectStartCommand(projectIdentifier: string, options: ProjectStartOptions): Promise<void> {
  // Handle --review mode: create project from description and start after approval
  if (options.review) {
    await projectStartWithReview(projectIdentifier, options);
    return;
  }

  const hasTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  const shouldUseInkUI = options.ui !== false && hasTTY;

  // Use interactive Ink UI by default (unless --no-ui or no TTY)
  if (shouldUseInkUI || options.interactive || options.verbose) {
    try {
      const { renderProjectStart } = await import('../../ui/apps/index.js');

      await renderProjectStart({
        projectIdentifier,
        verbose: options.verbose,
        maxParallel: options.maxParallel ?? 1,
        dryRun: options.dryRun,
        provider: options.provider,
      });
      return;
    } catch (error) {
      console.error(chalk.red('\n✗ Error starting interactive UI:'), error instanceof Error ? error.message : String(error));
      console.log(chalk.yellow('Falling back to non-interactive mode...\n'));
      // Fall through to non-interactive mode
    }
  } else if (!hasTTY && options.ui !== false) {
    console.log(chalk.yellow('⚠️  TTY not detected; run with --no-ui to skip this warning.'));
  }

  console.log(chalk.blue.bold('\n🚀 Starting Autonomous Project Work\n'));

  try {
    const cwd = process.cwd();
    const projectName = basename(cwd);
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    if (!config.github.owner || !config.github.repo) {
      console.error(chalk.red('Error: GitHub owner and repo not configured.'));
      console.error(chalk.red('Please run `auto config init` first.'));
      process.exit(1);
    }

    const githubToken = await getGitHubToken(config.github.token);
    if (!githubToken) {
      console.error(chalk.red('Error: GitHub token not found.'));
      process.exit(1);
    }

    // Find the project by name or number
    const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
    const projects = await discovery.getLinkedProjects();

    if (projects.length === 0) {
      console.error(chalk.red('Error: No projects linked to this repository.'));
      process.exit(1);
    }

    // Match by number or title (case-insensitive partial match)
    let matchedProject: DiscoveredProject | undefined;
    const searchTerm = projectIdentifier.toLowerCase();

    // Try exact number match first
    const projectNumber = parseInt(projectIdentifier);
    if (!isNaN(projectNumber)) {
      matchedProject = projects.find(p => p.number === projectNumber);
    }

    // Try title match
    if (!matchedProject) {
      matchedProject = projects.find(p =>
        p.title.toLowerCase() === searchTerm ||
        p.title.toLowerCase().includes(searchTerm)
      );
    }

    if (!matchedProject) {
      console.error(chalk.red(`Error: No project found matching "${projectIdentifier}"`));
      console.log(chalk.yellow('\nAvailable projects:'));
      for (const p of projects) {
        console.log(chalk.gray(`  #${p.number}: ${p.title}`));
      }
      process.exit(1);
    }

    console.log(chalk.green(`✓ Found project: ${matchedProject.title} (#${matchedProject.number})`));

    // Check if this project already has a running process
    const projectKey = `${config.github.owner}/${config.github.repo}#${matchedProject.number}`;
    if (runningProjects.has(projectKey)) {
      const running = runningProjects.get(projectKey)!;
      console.error(chalk.red(`\nError: Project already has an active process (PID: ${running.pid})`));
      console.log(chalk.yellow(`Worktree: ${running.worktreePath}`));
      console.log(chalk.yellow(`Instance: ${running.instanceId}`));
      console.log(chalk.gray('\nTo work on this project, first stop the existing process with Ctrl+C.'));
      process.exit(1);
    }

    // Initialize GitHub API and Project API
    const githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);

    // Use the matched project's ID directly (we already resolved which project)
    const projectsAPI = new GitHubProjectsAPI(matchedProject.id, config.project as ProjectConfig);

    // Initialize assignment manager
    const assignmentManager = new AssignmentManager(cwd, {
      projectAPI: projectsAPI,
    });
    await assignmentManager.initialize(projectName, cwd);

    // Initialize instance manager for slot-based naming
    const maxSlots = {
      claude: config.llms.claude.maxConcurrentIssues,
      gemini: config.llms.gemini.maxConcurrentIssues,
      codex: config.llms.codex.maxConcurrentIssues,
    };
    const instanceManager = new InstanceManager(assignmentManager, maxSlots);

    // Get items from this project that are ready for work
    const statusFieldName = config.project?.fields?.status?.fieldName;
    const readyStatuses = Array.from(
      new Set([
        ...(config.project?.fields?.status?.readyValues || ['Todo', 'Ready', 'Evaluated']),
        'Failed Review',
      ])
    );
    const items = await projectsAPI.getAllItems({
      status: readyStatuses,
    });

    // Look for in-progress items we should resume before picking new work
    const inProgressStatus = config.project?.fields?.status?.inProgressValue;
    let resumableItems: typeof items = [];
    if (inProgressStatus) {
      try {
        resumableItems = await projectsAPI.getAllItems({
          status: [inProgressStatus],
        });
      } catch (error) {
        console.log(chalk.yellow(`\n⚠️  Could not query in-progress items: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    const resumableWorkItems = resumableItems.filter(
      (item) => !PromptBuilder.isPhaseMaster(item.content.title)
    );

    console.log(chalk.blue(`\n📋 Project has ${items.length} items in ready status`));

    if (items.length === 0 && resumableWorkItems.length === 0) {
      console.log(chalk.yellow('\nNo items ready for work in this project.'));
      console.log(chalk.gray('Items need to be in one of these statuses: ' + readyStatuses.join(', ')));
      return;
    }

    // Show ready items (if any)
    if (items.length > 0) {
      console.log(chalk.gray('\nReady items:'));
      const displayLimit = Math.min(items.length, 10);
      for (let i = 0; i < displayLimit; i++) {
        const item = items[i];
        const marker = i === 0 ? chalk.green('→') : ' ';
        console.log(`${marker} ${chalk.gray(`#${item.content.number}:`)} ${item.content.title}`);
      }
      if (items.length > displayLimit) {
        console.log(chalk.gray(`  ... and ${items.length - displayLimit} more`));
      }
    }

    if (resumableWorkItems.length > 0) {
      console.log(chalk.gray(`\nFound ${resumableWorkItems.length} in-progress item(s) that can be resumed.`));
    }

    // Select item to work on (--item flag or first ready work item)
    let targetItem: typeof items[0] | undefined;
    let resumingExistingWork = false;

    if (options.item) {
      // Explicit item specified - look in ready and resumable lists (allow Phase Masters)
      targetItem =
        items.find(i => i.content.number === options.item) ||
        resumableItems.find(i => i.content.number === options.item);

      if (targetItem) {
        resumingExistingWork = resumableItems.some(i => i.content.number === targetItem!.content.number);
        const verb = resumingExistingWork ? 'Resuming in-progress item' : 'Working on specified item';
        console.log(chalk.green(`\n✓ ${verb} #${options.item}`));
      } else {
        console.log(chalk.yellow(`\n⚠️  Item #${options.item} not found in ready or in-progress items`));
      }
    } else {
      // Auto-select: skip Phase Master items, pick first actual work item
      // Phase Masters coordinate sub-items but shouldn't be auto-selected
      const workItems = items.filter(i => !PromptBuilder.isPhaseMaster(i.content.title));

      if (resumableWorkItems.length > 0) {
        targetItem = resumableWorkItems[0];
        resumingExistingWork = true;
        console.log(chalk.green(`\n✓ Resuming in-progress work item #${targetItem.content.number}`));
      } else if (workItems.length > 0) {
        targetItem = workItems[0];
        console.log(chalk.green(`\n✓ Working on first ready work item #${targetItem.content.number}`));
      } else {
        // Only Phase Masters are available - show message
        console.log(chalk.yellow('\n⚠️  Only Phase Master items are ready. These coordinate sub-items.'));
        console.log(chalk.gray('Phase Masters will auto-start when their sub-items are created.'));
        console.log(chalk.gray('Use --item <number> to explicitly work on a Phase Master.'));
        return;
      }
    }

    if (!targetItem) {
      console.log(chalk.red('\nNo valid item selected to work on.'));
      return;
    }

    const targetItemStatus = statusFieldName ? targetItem.fieldValues?.[statusFieldName] : undefined;
    const issueNumber = targetItem.content.number;
    const issue = await githubAPI.getIssue(issueNumber);
    console.log(chalk.cyan(`   ${issue.title}`));

    let failedReviewFeedback: Awaited<ReturnType<typeof getLatestFailedReviewFeedback>> = null;
    if (targetItemStatus === 'Failed Review') {
      try {
        failedReviewFeedback = await getLatestFailedReviewFeedback(githubAPI, issueNumber);
        if (failedReviewFeedback && options.verbose) {
          console.log(chalk.gray('   Latest failed review feedback will be passed to the LLM.'));
        }
      } catch (error) {
        if (options.verbose) {
          console.log(
            chalk.yellow(
              `   Unable to load failed review feedback for #${issueNumber}: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          );
        }
      }
    }

    // Check if issue is already assigned
    if (!resumingExistingWork && assignmentManager.isIssueAssigned(issueNumber)) {
      const existing = assignmentManager.getAllAssignments().find(a => a.issueNumber === issueNumber);
      console.log(chalk.yellow(`\nIssue #${issueNumber} is already assigned (status: ${existing?.status})`));
      console.log(chalk.gray(`Worktree: ${existing?.worktreePath}`));

      if (existing?.status === 'in-progress') {
        console.log(chalk.gray('\nTo resume, check the existing worktree or unassign first.'));
        return;
      }
    }

    // Generate branch name for the PROJECT (not per-issue)
    // All items in a project share one worktree and branch
    const projectSlug = matchedProject.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40);
    const branchName = `project/${matchedProject.number}-${projectSlug}`;

    // Calculate expected worktree path - ONE per project
    const expectedWorktreePath = join(
      cwd,
      config.worktree.baseDir || '..',
      `${projectName}-project-${matchedProject.number}`
    );

    // Dry run mode - exit early without creating worktrees or assignments
    if (options.dryRun) {
      console.log(chalk.yellow('\n🔍 Dry run mode - not creating any resources'));
      console.log(chalk.gray(`Would work on: #${issueNumber} - ${issue.title}`));
      console.log(chalk.gray(`Worktree path: ${expectedWorktreePath}`));
      console.log(chalk.gray(`Branch: ${branchName}`));
      console.log(chalk.gray(`Instance: Would use first available slot`));
      return;
    }

    // Create worktree for the PROJECT (shared across all items)
    console.log(chalk.blue('\n🌿 Setting up project worktree...'));
    const worktreeManager = new WorktreeManager(cwd);

    let worktreePath: string;
    try {
      await fs.access(expectedWorktreePath);
      console.log(chalk.green(`✓ Project worktree already exists: ${expectedWorktreePath}`));
      worktreePath = expectedWorktreePath;
    } catch {
      // Create new worktree for the project
      const defaultBranch = await worktreeManager.getDefaultBranch();
      worktreePath = await worktreeManager.createWorktree({
        issueNumber: matchedProject.number, // Use project number for naming
        branchName,
        baseDir: config.worktree.baseDir || '..',
        projectName,
        baseBranch: defaultBranch,
        customPath: expectedWorktreePath, // Override default path
      });
      console.log(chalk.green(`✓ Project worktree created: ${worktreePath}`));
    }

    const assignedInstanceFieldName = config.project?.fields?.assignedInstance?.fieldName;
    const resumeInstanceId =
      resumingExistingWork && assignedInstanceFieldName
        ? targetItem!.fieldValues?.[assignedInstanceFieldName]
        : undefined;
    const parsedResumeInstance =
      typeof resumeInstanceId === 'string'
        ? InstanceManager.parseInstanceId(resumeInstanceId)
        : null;

    // Get next available instance slot
    console.log(chalk.blue('\n🔍 Finding available instance slot...'));
    let llmProvider: LLMProvider;
    try {
      llmProvider = (parsedResumeInstance?.provider as LLMProvider) || resolveLLMProvider(config, options.provider);
    } catch (error) {
      console.error(chalk.red(`Error selecting provider: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }

    let availableSlot: InstanceSlot | null = null;
    if (parsedResumeInstance && parsedResumeInstance.provider === llmProvider) {
      const maxForProvider = config.llms[llmProvider].maxConcurrentIssues;
      if (parsedResumeInstance.slotNumber <= maxForProvider) {
        availableSlot = {
          provider: llmProvider,
          slotNumber: parsedResumeInstance.slotNumber,
          instanceId: resumeInstanceId as string,
          isAvailable: true,
        };
        console.log(chalk.gray(`Reusing assigned instance: ${resumeInstanceId}`));
      } else {
        console.log(
          chalk.yellow(
            `⚠️  Assigned instance ${resumeInstanceId} exceeds configured slots; selecting next available slot.`
          )
        );
      }
    }

    if (!availableSlot) {
      availableSlot = instanceManager.getNextAvailableSlot(llmProvider);
    }

    if (!availableSlot) {
      console.error(chalk.red(`✗ No available ${llmProvider} instances (max: ${config.llms[llmProvider].maxConcurrentIssues})`));
      console.log(chalk.yellow('Try increasing maxConcurrentIssues in .autonomous-config.json'));
      process.exit(1);
    }

    console.log(chalk.green(`✓ Assigned to slot: ${availableSlot.instanceId}`));

    // Create assignment
    console.log(chalk.blue('\n📝 Creating assignment...'));
    const assignment = await assignmentManager.createAssignment({
      issueNumber,
      issueTitle: issue.title,
      issueBody: issue.body || undefined,
      issueUrl: issue.htmlUrl, // Include issue URL for easy reference
      llmProvider,
      worktreePath,
      branchName,
      requiresTests: config.requirements.testingRequired,
      requiresCI: config.requirements.ciMustPass,
    });
    if (failedReviewFeedback && assignment.metadata) {
      assignment.metadata.failedReviewFeedback = failedReviewFeedback.body;
      assignment.metadata.failedReviewAt = failedReviewFeedback.createdAt;
    }
    // Update assignment with slot-based instance ID
    await assignmentManager.updateAssignment(assignment.id, {
      llmInstanceId: availableSlot.instanceId,
    });
    assignment.llmInstanceId = availableSlot.instanceId;

    // Detect phase master
    const isPhaseMaster = PromptBuilder.isPhaseMaster(issue.title);
    if (isPhaseMaster && assignment.metadata) {
      assignment.metadata.isPhaseMaster = true;
      console.log(chalk.blue('📋 Phase Master detected - will use coordination workflow'));
    }

    // Link assignment to project item
    await assignmentManager.ensureProjectItemId(assignment.id);
    console.log(chalk.gray('✓ Linked to project'));

    // Update assigned instance field in project
    await assignmentManager.updateAssignedInstanceWithSync(assignment.id, availableSlot.instanceId);

    // Generate prompt (continuation when resuming existing in-progress work)
    const prompt = resumingExistingWork
      ? PromptBuilder.buildContinuationPrompt({
          assignment,
          worktreePath,
          lastSummary:
            assignment.workSessions.length > 0
              ? assignment.workSessions[assignment.workSessions.length - 1].summary
              : undefined,
        })
      : PromptBuilder.buildInitialPrompt({
          assignment,
          worktreePath,
        });

    // Start LLM instance
    console.log(chalk.blue('\n🤖 Starting LLM instance...'));

    const autonomousDataDir = join(cwd, '.autonomous');
    await fs.mkdir(autonomousDataDir, { recursive: true });

    const llmAdapter = LLMFactory.create([llmProvider], config.llms, autonomousDataDir, options.verbose || false);

    await llmAdapter.start({
      assignment,
      prompt,
      workingDirectory: worktreePath,
    });

    // Update assignment status
    await assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');

    // Add work session
    await assignmentManager.addWorkSession(assignment.id, {
      startedAt: new Date().toISOString(),
      promptUsed: prompt,
      summary: resumingExistingWork ? 'Resumed in-progress work after previous exit' : undefined,
    });

    // Record running project
    runningProjects.set(projectKey, {
      pid: process.pid,
      worktreePath,
      instanceId: availableSlot.instanceId,
    });

    console.log(chalk.green('\n✓ Autonomous work started!'));
    console.log(chalk.gray(`\nWorktree: ${worktreePath}`));
    console.log(chalk.gray(`Branch: ${branchName}`));
    console.log(chalk.gray(`Instance ID: ${assignment.llmInstanceId}`));

    // Show log file location
    const logFile = join(autonomousDataDir, 'logs', `output-${assignment.llmInstanceId}.log`);
    console.log(chalk.blue(`\n📊 Monitor progress:`));
    console.log(chalk.gray(`  tail -f ${logFile}`));
    console.log(chalk.gray(`  auto status`));

    if (options.verbose) {
      console.log(chalk.blue('\n📡 Streaming LLM output...\n'));
      console.log(chalk.gray('─'.repeat(80)));
    } else {
      console.log(chalk.blue('\nLLM is now working...'));
      console.log(chalk.gray('Tip: Use --verbose flag to stream LLM output in real-time'));
      console.log('Press Ctrl+C to stop\n');
    }

    // Track running state
    let isRunning = true;
    let currentAssignment = assignment;
    let currentInstanceId = availableSlot.instanceId;
    let lastLogActivityMs = Date.now();
    let lastIdleRestartMs = 0;

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\nStopping autonomous work...'));
      isRunning = false;
      try {
        await llmAdapter.stop(currentInstanceId);
        runningProjects.delete(projectKey);
      } catch (e) {
        // Ignore stop errors
      }
      console.log(chalk.green('✓ Stopped'));
      process.exit(0);
    });

    // Monitoring loop - check for completion and continue with next item
    console.log(chalk.blue('\n🔄 Monitoring for completion...\n'));

    while (isRunning) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds (Stop hook signals immediately)

      if (!isRunning) break;

      try {
        // Check if LLM has finished responding (via Stop hook)
        const status = await llmAdapter.getStatus(currentInstanceId);
        const logPath = join(autonomousDataDir, 'logs', `output-${currentInstanceId}.log`);

        // Detect idle/no-output sessions and restart with a continuation prompt
        try {
          const stats = await fs.stat(logPath);
          lastLogActivityMs = Math.max(lastLogActivityMs, stats.mtimeMs);
          const idleTimeoutMs = 5 * 60 * 1000; // 5 minutes
          const now = Date.now();
          const isIdle = now - stats.mtimeMs > idleTimeoutMs;
          const canRestart = now - lastIdleRestartMs > idleTimeoutMs / 2;

          if (status.isRunning && isIdle && canRestart) {
            console.log(chalk.yellow('\n⚠️  No log activity detected for 5 minutes - restarting session...'));
            lastIdleRestartMs = now;
            try {
              await llmAdapter.stop(currentInstanceId);
            } catch {
              // Ignore stop errors
            }

            const continuePrompt = PromptBuilder.buildContinuationPrompt({
              assignment: currentAssignment,
              worktreePath,
              lastSummary:
                currentAssignment.workSessions.length > 0
                  ? currentAssignment.workSessions[currentAssignment.workSessions.length - 1].summary
                  : undefined,
            });

            const newInstanceId = await llmAdapter.start({
              assignment: currentAssignment,
              prompt: continuePrompt,
              workingDirectory: worktreePath,
            });

            await assignmentManager.updateAssignment(currentAssignment.id, {
              llmInstanceId: newInstanceId,
              lastActivity: new Date().toISOString(),
            });
            await assignmentManager.addWorkSession(currentAssignment.id, {
              startedAt: new Date().toISOString(),
              promptUsed: continuePrompt,
              summary: 'Session restarted after idle detection',
            });
            await assignmentManager.updateAssignedInstanceWithSync(currentAssignment.id, newInstanceId);

            currentInstanceId = newInstanceId;
            currentAssignment.llmInstanceId = newInstanceId;
            continue; // Skip completion check to let new session run
          }
        } catch {
          // Ignore stat errors
        }

        if (!status.isRunning) {
          // LLM finished responding - stop the process and process completion
          console.log(chalk.gray('\n📝 LLM finished responding, analyzing results...'));

          // Stop the LLM process (it's waiting for input)
          try {
            await llmAdapter.stop(currentInstanceId);
          } catch {
            // Process may have already exited, ignore
          }

          let autoSignals = detectAutonomousSignals(logPath);
          if (llmProvider === 'codex') {
            // Codex logs include the prompt text (with example signals) but no assistant output yet.
            // Ignore autonomous signals to avoid false positives from the prompt itself.
            autoSignals = {
              hasSignal: false,
              isComplete: false,
              isBlocked: false,
              isFailed: false,
            };
          }
          const sessionAnalysis = detectSessionCompletion(logPath);
          const prNumber = autoSignals.prNumber ?? extractPRNumber(logPath);
          const isPhaseMaster = currentAssignment.metadata?.isPhaseMaster === true;
          const hasPR = prNumber !== undefined;
          const hasIndicators =
            autoSignals.hasSignal ||
            sessionAnalysis.indicators.length > 0;

          const isSuccessfulSession =
            autoSignals.isComplete ||
            sessionAnalysis.isComplete ||
            (hasIndicators && !autoSignals.isFailed && !autoSignals.isBlocked) ||
            (hasPR && !autoSignals.isFailed && !autoSignals.isBlocked);

          if (isSuccessfulSession || (isPhaseMaster && hasPR)) {
            // SUCCESS: Session completed
            console.log(chalk.green(`\n✓ Completed item #${currentAssignment.issueNumber}: ${currentAssignment.issueTitle}`));
            if (prNumber) {
              console.log(chalk.blue(`   PR created: #${prNumber}`));
            }

            // Update assignment status
            await assignmentManager.updateAssignment(currentAssignment.id, {
              status: 'dev-complete',
              completedAt: new Date().toISOString(),
            });

            // Update GitHub project status
            if (currentAssignment.projectItemId) {
              try {
                await projectsAPI.updateItemStatusByValue(currentAssignment.projectItemId, 'Dev Complete');
                await assignmentManager.updateAssignedInstanceWithSync(currentAssignment.id, null);
                console.log(chalk.gray('   Updated project status to Dev Complete'));
              } catch (e) {
                // Ignore project update errors
              }
            }

            // Pick next ready item from the project
            console.log(chalk.blue('\n🔍 Looking for next ready item...\n'));

            const refreshedItems = await projectsAPI.getAllItems({
              status: readyStatuses,
            });

            // Filter out Phase Masters and already assigned items
            const nextWorkItems = refreshedItems.filter(i =>
              !PromptBuilder.isPhaseMaster(i.content.title) &&
              !assignmentManager.isIssueAssigned(i.content.number)
            );

            if (nextWorkItems.length === 0) {
              console.log(chalk.green('\n🎉 All project items completed!'));
              console.log(chalk.gray('No more ready items to work on.\n'));
              runningProjects.delete(projectKey);
              break;
            }

            // Start on next item
            const nextItem = nextWorkItems[0];
            const nextItemStatus = statusFieldName ? nextItem.fieldValues?.[statusFieldName] : undefined;
            const nextIssue = await githubAPI.getIssue(nextItem.content.number);
            console.log(chalk.cyan(`📋 Starting next item: #${nextIssue.number} - ${nextIssue.title}`));

            let nextFailedReviewFeedback: Awaited<ReturnType<typeof getLatestFailedReviewFeedback>> = null;
            if (nextItemStatus === 'Failed Review') {
              try {
                nextFailedReviewFeedback = await getLatestFailedReviewFeedback(githubAPI, nextItem.content.number);
                if (nextFailedReviewFeedback && options.verbose) {
                  console.log(chalk.gray('   Latest failed review feedback will be passed to the LLM.'));
                }
              } catch (error) {
                if (options.verbose) {
                  console.log(
                    chalk.yellow(
                      `   Unable to load failed review feedback for #${nextItem.content.number}: ${
                        error instanceof Error ? error.message : String(error)
                      }`
                    )
                  );
                }
              }
            }

            // Create new assignment
            const nextAssignment = await assignmentManager.createAssignment({
              issueNumber: nextIssue.number,
              issueTitle: nextIssue.title,
              issueBody: nextIssue.body || undefined,
              issueUrl: nextIssue.htmlUrl, // Include issue URL for easy reference
              llmProvider,
              worktreePath,
              branchName,
              requiresTests: config.requirements.testingRequired,
              requiresCI: config.requirements.ciMustPass,
            });
            if (nextFailedReviewFeedback && nextAssignment.metadata) {
              nextAssignment.metadata.failedReviewFeedback = nextFailedReviewFeedback.body;
              nextAssignment.metadata.failedReviewAt = nextFailedReviewFeedback.createdAt;
            }

            // Get next slot (reuse the same slot since previous work is done)
            const nextSlot = instanceManager.getNextAvailableSlot(llmProvider);
            if (!nextSlot) {
              console.error(chalk.red(`✗ No available ${llmProvider} slots`));
              break;
            }

            await assignmentManager.updateAssignment(nextAssignment.id, {
              llmInstanceId: nextSlot.instanceId,
            });
            nextAssignment.llmInstanceId = nextSlot.instanceId;

            // Link to project
            await assignmentManager.ensureProjectItemId(nextAssignment.id);
            await assignmentManager.updateAssignedInstanceWithSync(nextAssignment.id, nextSlot.instanceId);

            // Generate prompt and start LLM
            const nextPrompt = PromptBuilder.buildInitialPrompt({
              assignment: nextAssignment,
              worktreePath,
            });

            await llmAdapter.start({
              assignment: nextAssignment,
              prompt: nextPrompt,
              workingDirectory: worktreePath,
            });

            await assignmentManager.updateStatusWithSync(nextAssignment.id, 'in-progress');
            await assignmentManager.addWorkSession(nextAssignment.id, {
              startedAt: new Date().toISOString(),
              promptUsed: nextPrompt,
            });

            // Update tracking
            currentAssignment = nextAssignment;
            currentInstanceId = nextSlot.instanceId;

            console.log(chalk.green(`✓ Started working on #${nextIssue.number}`));
            console.log(chalk.gray(`   Instance: ${currentInstanceId}\n`));

          } else {
            if (autoSignals.isBlocked) {
              console.log(chalk.yellow(`\n⚠️  LLM reported it is blocked: ${autoSignals.blockedReason || 'no reason provided'}`));
              console.log(chalk.gray('   Stopping without starting a new item.'));
              runningProjects.delete(projectKey);
              break;
            }
            if (autoSignals.isFailed) {
              console.log(chalk.red(`\n❌ LLM reported failure: ${autoSignals.failedReason || 'no reason provided'}`));
              console.log(chalk.gray('   Stopping without starting a new item.'));
              runningProjects.delete(projectKey);
              break;
            }
            // Process exited but not complete - try to resurrect
            console.log(chalk.yellow(`\n⚠️  Process exited without completion for #${currentAssignment.issueNumber}`));
            console.log(chalk.blue('   Attempting to resurrect...\n'));

            // Generate continuation prompt
            const continuePrompt = PromptBuilder.buildContinuationPrompt({
              assignment: currentAssignment,
              worktreePath,
              lastSummary: currentAssignment.workSessions.length > 0
                ? currentAssignment.workSessions[currentAssignment.workSessions.length - 1].summary
                : undefined,
            });

            // Restart LLM
            const newInstanceId = await llmAdapter.start({
              assignment: currentAssignment,
              prompt: continuePrompt,
              workingDirectory: worktreePath,
            });

            await assignmentManager.updateAssignment(currentAssignment.id, {
              lastActivity: new Date().toISOString(),
            });
            await assignmentManager.addWorkSession(currentAssignment.id, {
              startedAt: new Date().toISOString(),
              promptUsed: continuePrompt,
              summary: 'Process resurrected after unexpected exit',
            });

            currentInstanceId = newInstanceId;
            currentAssignment.llmInstanceId = newInstanceId;

            console.log(chalk.green(`✓ Process resurrected with instance: ${newInstanceId}\n`));
          }
        }
      } catch (error) {
        console.error(chalk.yellow('⚠️  Monitoring error (will retry):'), error instanceof Error ? error.message : String(error));
      }
    }

  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error starting project:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

interface ProjectCreateOptions extends ProjectCommandOptions {
  review?: boolean;
  reviewed?: boolean;
  start?: boolean;
}

/**
 * Start a project with review - creates project from description, allows iteration, then starts work
 */
async function projectStartWithReview(
  description: string,
  options: ProjectStartOptions
): Promise<void> {
  console.log(chalk.blue.bold('\n🎯 Creating and Starting Project (Review Mode)\n'));

  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    if (!config.github.owner || !config.github.repo) {
      console.error(chalk.red('Error: GitHub owner and repo not configured.'));
      console.error(chalk.red('Please run `auto config init` first.'));
      process.exit(1);
    }

    if (!config.project?.enabled) {
      console.error(chalk.red('Error: GitHub Project not configured.'));
      console.error(chalk.red('Please run `auto project init` first.'));
      process.exit(1);
    }


    const llmProvider = 'claude'; // For now, we are hardcoding this value
    const llmConfig = config.llms[llmProvider];
    const claudePath = llmConfig.cliPath || 'claude';

    // Step 1: Generate project plan
    console.log(chalk.cyan('🤖 Generating project plan...\n'));
    let currentPlan = await generateProjectPlan(description, claudePath, cwd);

    console.log(chalk.blue('━'.repeat(60)));
    console.log(currentPlan);
    console.log(chalk.blue('━'.repeat(60)));

    // Step 2: Review loop
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = (question: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(question, (answer) => {
          resolve(answer);
        });
      });
    };

    let approved = false;
    while (!approved) {
      console.log(chalk.yellow('\n📋 Review Options:'));
      console.log(chalk.gray('  [Enter] - Approve, create project, and start work'));
      console.log(chalk.gray('  [c]     - Cancel'));
      console.log(chalk.gray('  [text]  - Provide feedback to refine the plan'));

      const input = await askQuestion(chalk.cyan('\n> '));

      if (input.toLowerCase() === 'c' || input.toLowerCase() === 'cancel') {
        console.log(chalk.yellow('\n✗ Project creation cancelled.'));
        rl.close();
        return;
      } else if (input.trim() === '') {
        approved = true;
      } else {
        // Refine the plan based on feedback
        console.log(chalk.cyan('\n🔄 Refining plan based on your feedback...\n'));
        currentPlan = await refineProjectPlan(currentPlan, input, claudePath, cwd);

        console.log(chalk.blue('━'.repeat(60)));
        console.log(currentPlan);
        console.log(chalk.blue('━'.repeat(60)));
      }
    }

    rl.close();

    // Step 3: Parse plan into structured items
    console.log(chalk.cyan('\n🔍 Parsing project structure...\n'));
    const { projectTitle, items } = parseProjectPlan(currentPlan);

    const masterCount = items.filter(i => i.isMaster).length;
    const workCount = items.filter(i => !i.isMaster).length;
    console.log(chalk.gray(`  Found ${masterCount} phases with ${workCount} work items`));

    if (items.length === 0) {
      console.error(chalk.red('\n✗ Could not parse project plan. Please check the format.'));
      process.exit(1);
    }

    // Step 4: Create new GitHub Project
    console.log(chalk.cyan('\n📋 Creating GitHub Project board...\n'));

    const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
    const newProject = await discovery.createProject(projectTitle);

    console.log(chalk.green(`✓ Created project: ${newProject.title} (#${newProject.number})`));
    console.log(chalk.gray(`  ${newProject.url}`));

    // Link project to repository
    console.log(chalk.blue('\n🔗 Linking project to repository...'));
    await discovery.linkProjectToRepo(newProject.id);
    console.log(chalk.green('✓ Project linked to repository'));

    // Step 5: Create GitHub issues

    const projectsAPI = new GitHubProjectsAPI(newProject.id, config.project);
    await projectsAPI.ensureAllTemplateFields();

    console.log(chalk.cyan(`\n📝 Creating ${items.length} issues for "${projectTitle}"...\n`));
    await createProjectIssues(
      items,
      projectTitle,
      config.github.owner,
      config.github.repo,
      projectsAPI,
      newProject.number,
      options.verbose
        ? (current: number, total: number, title: string) => {
            console.log(chalk.gray(`  Creating (${current}/${total}): ${title}`));
          }
        : (current: number, total: number) => {
            if (current === 1) process.stdout.write('  ');
            process.stdout.write(chalk.green('.'));
            if (current === total) console.log('');
          }
    );
    console.log(chalk.green.bold(`\n✅ Project "${projectTitle}" created with ${items.length} issues!\n`));

    // Step 6: Start working on the first item
    console.log(chalk.blue.bold('\n🚀 Starting autonomous work on the new project...\n'));

    // Get the first phase's first work item
    const firstWorkItem = items.find(i => !i.isMaster && i.phaseNumber === 1);
    if (!firstWorkItem) {
      console.log(chalk.yellow('No work items found in Phase 1. Project created but not started.'));
      console.log(chalk.gray(`  View project: ${newProject.url}`));
      return;
    }

    // Now start work using the project title as the identifier
    console.log(chalk.cyan(`📍 Will work on first ready item from "${projectTitle}"`));
    console.log(chalk.gray(`  View project: ${newProject.url}`));
    console.log(chalk.gray('\nRun `auto start` to begin autonomous work on this project.'));

  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Generate a project plan using Claude
 */
// Project creation functions moved to src/services/project-creation.ts
// and are imported above

/**
 * Create a new project from a description
 * Generates a phased project plan and creates issues in GitHub
 */
export async function projectCreateCommand(
  description: string,
  options: ProjectCreateOptions
): Promise<void> {
  console.log(chalk.blue.bold('\n🎯 Creating New Project\n'));

  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    if (!config.github.owner || !config.github.repo) {
      console.error(chalk.red('Error: GitHub owner and repo not configured.'));
      console.error(chalk.red('Please run `auto config init` first.'));
      process.exit(1);
    }

    if (!config.project?.enabled) {
      console.error(chalk.red('Error: GitHub Project not configured.'));
      console.error(chalk.red('Please run `auto project init` first.'));
      process.exit(1);
    }


    const llmProvider = 'claude'; // For now, we are hardcoding this value
    const llmConfig = config.llms[llmProvider];
    const claudePath = llmConfig.cliPath || 'claude';

    // If --reviewed flag is set, use the two-stage Ink UI workflow
    if (options.reviewed) {
      await renderProjectCreation({
        description,
        claudePath,
        workingDirectory: cwd,
        onComplete: async (implementationPlanPath: string) => {
          console.log(chalk.green.bold('\n✅ Implementation plan approved!\n'));
          console.log(chalk.cyan('📄 Plan saved to: ' + implementationPlanPath));

          // Read the implementation plan
          const planContent = await fs.readFile(implementationPlanPath, 'utf-8');

          // Parse plan into structured items
          console.log(chalk.cyan('\n🔍 Parsing project structure...\n'));
          const { projectTitle, items } = parseProjectPlan(planContent);

          const masterCount = items.filter(i => i.isMaster).length;
          const workCount = items.filter(i => !i.isMaster).length;
          console.log(chalk.gray(`  Found ${masterCount} phases with ${workCount} work items`));

          // Create GitHub project board
          console.log(chalk.cyan('\n📋 Creating GitHub Project board...\n'));
          const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
          const newProject = await discovery.createProject(projectTitle);

          console.log(chalk.green(`✓ Created project: ${newProject.title} (#${newProject.number})`));
          console.log(chalk.gray(`  ${newProject.url}`));

          // Link project to repository
          console.log(chalk.blue('\n🔗 Linking project to repository...'));
          await discovery.linkProjectToRepo(newProject.id);
          console.log(chalk.green('✓ Project linked to repository'));

          // Ensure status options
          if (!config.project) {
            throw new Error('Project configuration not found');
          }
          const projectsAPI = new GitHubProjectsAPI(newProject.id, config.project);
          await projectsAPI.ensureAllTemplateFields();

          // Create GitHub issues
          console.log(chalk.cyan(`\n📝 Creating ${items.length} issues for "${projectTitle}"...\n`));
          await createProjectIssues(
            items,
            projectTitle,
            config.github.owner,
            config.github.repo,
            projectsAPI,
            newProject.number,
            options.verbose
              ? (current: number, total: number, title: string) => {
                  console.log(chalk.gray(`  Creating (${current}/${total}): ${title}`));
                }
              : (current: number, total: number) => {
                  if (current === 1) process.stdout.write('  ');
                  process.stdout.write(chalk.green('.'));
                  if (current === total) console.log('');
                }
          );

          console.log(chalk.green.bold(`\n✅ Project "${projectTitle}" created with ${items.length} issues!\n`));
          console.log(chalk.cyan(`\n🔗 Project URL: ${newProject.url}\n`));
        },
        onCancel: () => {
          console.log(chalk.yellow('\n✗ Project creation cancelled.\n'));
          process.exit(0);
        }
      });
      return;
    }

    // Step 1: Generate project plan
    console.log(chalk.cyan('🤖 Generating project plan...\n'));
    let currentPlan = await generateProjectPlan(description, claudePath, cwd);

    console.log(chalk.blue('━'.repeat(60)));
    console.log(currentPlan);
    console.log(chalk.blue('━'.repeat(60)));

    // Step 2: Review loop (if --review flag is set)
    if (options.review) {
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const askQuestion = (question: string): Promise<string> => {
        return new Promise((resolve) => {
          rl.question(question, (answer) => {
            resolve(answer);
          });
        });
      };

      let approved = false;
      while (!approved) {
        console.log(chalk.yellow('\n📋 Review Options:'));
        console.log(chalk.gray('  [Enter] - Approve and create project'));
        console.log(chalk.gray('  [c]     - Cancel'));
        console.log(chalk.gray('  [text]  - Provide feedback to refine the plan'));

        const input = await askQuestion(chalk.cyan('\n> '));

        if (input.toLowerCase() === 'c' || input.toLowerCase() === 'cancel') {
          console.log(chalk.yellow('\n✗ Project creation cancelled.'));
          rl.close();
          return;
        } else if (input.trim() === '') {
          approved = true;
        } else {
          // Refine the plan based on feedback
          console.log(chalk.cyan('\n🔄 Refining plan based on your feedback...\n'));
          currentPlan = await refineProjectPlan(currentPlan, input, claudePath, cwd);

          console.log(chalk.blue('━'.repeat(60)));
          console.log(currentPlan);
          console.log(chalk.blue('━'.repeat(60)));
        }
      }

      rl.close();
    }

    // Step 3: Parse plan into structured items
    console.log(chalk.cyan('\n🔍 Parsing project structure...\n'));
    const { projectTitle, items } = parseProjectPlan(currentPlan);

    const masterCount = items.filter(i => i.isMaster).length;
    const workCount = items.filter(i => !i.isMaster).length;
    console.log(chalk.gray(`  Found ${masterCount} phases with ${workCount} work items`));

    if (items.length === 0) {
      console.error(chalk.red('\n✗ Could not parse project plan. Please check the format.'));
      process.exit(1);
    }

    // Step 4: Create new GitHub Project
    console.log(chalk.cyan('\n📋 Creating GitHub Project board...\n'));

    const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
    const newProject = await discovery.createProject(projectTitle);

    console.log(chalk.green(`✓ Created project: ${newProject.title} (#${newProject.number})`));
    console.log(chalk.gray(`  ${newProject.url}`));

    // Link project to repository
    console.log(chalk.blue('\n🔗 Linking project to repository...'));
    await discovery.linkProjectToRepo(newProject.id);
    console.log(chalk.green('✓ Project linked to repository'));

    // Step 5: Create GitHub issues

    const projectsAPI = new GitHubProjectsAPI(newProject.id, config.project);

    console.log(chalk.cyan(`\n📝 Creating ${items.length} issues for "${projectTitle}"...\n`));
    await createProjectIssues(
      items,
      projectTitle,
      config.github.owner,
      config.github.repo,
      projectsAPI,
      newProject.number,
      options.verbose
        ? (current: number, total: number, title: string) => {
            console.log(chalk.gray(`  Creating (${current}/${total}): ${title}`));
          }
        : (current: number, total: number) => {
            if (current === 1) process.stdout.write('  ');
            process.stdout.write(chalk.green('.'));
            if (current === total) console.log('');
          }
    );
    console.log(chalk.green.bold(`\n✅ Project "${projectTitle}" created with ${items.length} issues!\n`));

    // If --start flag is set, automatically start working on the project
    if (options.start) {
      console.log(chalk.blue.bold('\n🚀 Starting autonomous work on the new project...\n'));

      // Start work using the project title as the identifier
      await projectStartCommand(projectTitle, {
        verbose: options.verbose,
      });
    } else {
      console.log(chalk.blue('\n💡 Next steps:'));
      console.log(chalk.gray('  • Run `auto project list-ready` to see ready items'));
      console.log(chalk.gray(`  • Run \`auto project start "${projectTitle}"\` to begin autonomous work`));
      console.log(chalk.gray(`  • View project: ${newProject.url}`));
    }

  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error creating project:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

interface ProjectAddOptions extends ProjectCommandOptions {
  project: string;
  start?: boolean;
}

interface ProjectReviewOptions extends ProjectCommandOptions {
  all?: boolean;      // Review ALL items, not just "In Review"
  multi?: boolean;    // Use all personas, not just architect
  maxParallel?: number;  // Max concurrent reviews (default: 3)
}

/**
 * Add issues to an existing GitHub Project from a description
 * Uses the same plan generation as project create, but adds to existing project
 */
export async function projectAddCommand(
  description: string,
  options: ProjectAddOptions
): Promise<void> {
  console.log(chalk.blue.bold('\n📝 Adding Issues to Existing Project\n'));

  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    if (!config.github.owner || !config.github.repo) {
      console.error(chalk.red('Error: GitHub owner and repo not configured.'));
      console.error(chalk.red('Please run `auto config init` first.'));
      process.exit(1);
    }

const llmProvider = 'claude'; // For now, we are hardcoding this value
    const llmConfig = config.llms[llmProvider];
    const claudePath = llmConfig.cliPath || 'claude';
    const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
    const linkedProjects = await discovery.getLinkedProjects();

    if (linkedProjects.length === 0) {
      console.error(chalk.red('Error: No projects linked to this repository.'));
      console.error(chalk.yellow('Use `auto project create` to create a new project.'));
      process.exit(1);
    }

    // Find project by number or name
    const searchTerm = options.project.toLowerCase();
    const projectNumber = parseInt(options.project);

    let targetProject: DiscoveredProject | undefined;

    if (!isNaN(projectNumber)) {
      targetProject = linkedProjects.find(p => p.number === projectNumber);
    }
    if (!targetProject) {
      targetProject = linkedProjects.find(p =>
        p.title.toLowerCase() === searchTerm ||
        p.title.toLowerCase().includes(searchTerm)
      );
    }

    if (!targetProject) {
      console.error(chalk.red(`Error: No project found matching "${options.project}"`));
      console.log(chalk.yellow('\nAvailable projects:'));
      for (const p of linkedProjects) {
        console.log(chalk.gray(`  #${p.number}: ${p.title}`));
      }
      process.exit(1);
    }

    console.log(chalk.green(`✓ Target project: ${targetProject.title} (#${targetProject.number})`));

    // Generate project plan
    console.log(chalk.cyan('\n🤖 Generating work items...\n'));
    const currentPlan = await generateProjectPlan(description, claudePath, cwd);

    console.log(chalk.blue('━'.repeat(60)));
    console.log(currentPlan);
    console.log(chalk.blue('━'.repeat(60)));

    // Parse plan into items
    console.log(chalk.cyan('\n🔍 Parsing structure...\n'));
    const { projectTitle, items } = parseProjectPlan(currentPlan);

    const masterCount = items.filter(i => i.isMaster).length;
    const workCount = items.filter(i => !i.isMaster).length;
    console.log(chalk.gray(`  Found ${masterCount} phases with ${workCount} work items`));

    if (items.length === 0) {
      console.error(chalk.red('\n✗ Could not parse project plan. Please check the format.'));
      process.exit(1);
    }

    // Create GitHub issues

    const projectsAPI = new GitHubProjectsAPI(targetProject.id, config.project as ProjectConfig);
    await projectsAPI.ensureAllTemplateFields();

    console.log(chalk.cyan(`\n📝 Creating ${items.length} issues for "${projectTitle}"...\n`));
    await createProjectIssues(
      items,
      projectTitle,
      config.github.owner,
      config.github.repo,
      projectsAPI,
      targetProject.number,
      options.verbose
        ? (current: number, total: number, title: string) => {
            console.log(chalk.gray(`  Creating (${current}/${total}): ${title}`));
          }
        : (current: number, total: number) => {
            if (current === 1) process.stdout.write('  ');
            process.stdout.write(chalk.green('.'));
            if (current === total) console.log('');
          }
    );
    console.log(chalk.green.bold(`\n✅ Issues added to project "${targetProject.title}"!\n`));

    // If --start flag is set, start working
    if (options.start) {
      console.log(chalk.blue.bold('\n🚀 Starting autonomous work...\n'));

      await projectStartCommand(targetProject.title, {
        verbose: options.verbose,
      });
    } else {
      console.log(chalk.blue('\n💡 Next steps:'));
      console.log(chalk.gray('  • Run `auto project list-ready` to see ready items'));
      console.log(chalk.gray(`  • Run \`auto project start "${targetProject.title}"\` to begin autonomous work`));
      console.log(chalk.gray(`  • View project: ${targetProject.url}`));
    }

  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error adding to project:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Review items in a GitHub Project using Ink UI
 *
 * Default: Reviews only "In Review" items with architect persona
 * --all: Review ALL items in the project
 * --multi: Use all personas (architect, product-manager, senior-engineer, qa-engineer, security-engineer)
 */
export async function projectReviewCommand(
  projectIdentifier: string,
  options: ProjectReviewOptions
): Promise<void> {
  try {
    // Dynamic import for ESM-only ink
    const { renderProjectReview } = await import('../../ui/apps/index.js');

    await renderProjectReview({
      projectIdentifier,
      allItems: options.all,
      multiPersona: options.multi,
      verbose: options.verbose,
      maxParallel: options.maxParallel || 3,
    });
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error reviewing project:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

interface ProjectDesignOptions extends ProjectCommandOptions {
  interactive?: boolean;
}

/**
 * Design or modify a GitHub Project using Claude with /sc:design
 *
 * Usage:
 *   auto project design "create user management system"  - Create new project
 *   auto project design 12 "add authentication component" - Modify project #12
 */
export async function projectDesignCommand(
  projectNumberOrDescription: string,
  descriptionOrOptions?: string | ProjectDesignOptions,
  maybeOptions?: ProjectDesignOptions
): Promise<void> {
  // Parse arguments - handle both signatures:
  // design <description> [options]
  // design <number> <description> [options]
  const projectNumber = parseInt(projectNumberOrDescription);
  const isModify = !isNaN(projectNumber);

  const description = isModify ? (descriptionOrOptions as string) : projectNumberOrDescription;
  const options = isModify ? (maybeOptions || {}) : (descriptionOrOptions as ProjectDesignOptions || {});

  if (isModify) {
    await projectDesignModifyCommand(projectNumber, description, options);
  } else {
    await projectDesignCreateCommand(description, options);
  }
}

/**
 * Create a new GitHub Project using Claude with /sc:design directive
 */
async function projectDesignCreateCommand(
  description: string,
  options: ProjectDesignOptions
): Promise<void> {
  console.log(chalk.blue.bold('\n🎨 Designing New Project with Claude\n'));

  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    if (!config.github.owner || !config.github.repo) {
      console.error(chalk.red('Error: GitHub owner and repo not configured.'));
      console.error(chalk.red('Please run `auto config init` first.'));
      process.exit(1);
    }

    const llmProvider = 'claude';
    const llmConfig = config.llms[llmProvider];
    const claudePath = llmConfig.cliPath || 'claude';

    // Build design prompt with /sc:design directive
    const designPrompt = `/sc:design

Design a GitHub Project for the following requirement:

${description}

Please create a comprehensive project plan that includes:
1. Project title
2. Phased breakdown with Phase Masters
3. Detailed work items for each phase
4. Dependencies between phases

Format the output according to the project plan template.`;

    console.log(chalk.cyan('🤖 Generating project design with Claude...\n'));

    // Use spawn to run Claude interactively
    const { spawn } = await import('child_process');

    const proc = spawn(claudePath, [], {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        CLAUDE_PROMPT: designPrompt,
      },
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(chalk.green('\n✓ Project design completed!'));
        console.log(chalk.gray('\nUse the output to create your project with:'));
        console.log(chalk.gray('  auto project create "<title>"'));
      } else {
        console.error(chalk.red(`\n✗ Claude exited with code ${code}`));
        process.exit(1);
      }
    });

  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error designing project:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Modify an existing GitHub Project using Claude with /sc:design directive
 */
async function projectDesignModifyCommand(
  projectNumber: number,
  description: string,
  options: ProjectDesignOptions
): Promise<void> {
  console.log(chalk.blue.bold(`\n🎨 Modifying GitHub Project #${projectNumber} with Claude\n`));

  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    if (!config.github.owner || !config.github.repo) {
      console.error(chalk.red('Error: GitHub owner and repo not configured.'));
      console.error(chalk.red('Please run `auto config init` first.'));
      process.exit(1);
    }

    // Find the project
    const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
    const linkedProjects = await discovery.getLinkedProjects();
    const targetProject = linkedProjects.find(p => p.number === projectNumber);

    if (!targetProject) {
      console.error(chalk.red(`Error: Project #${projectNumber} not found`));
      console.log(chalk.yellow('\nAvailable projects:'));
      for (const p of linkedProjects) {
        console.log(chalk.gray(`  #${p.number}: ${p.title}`));
      }
      process.exit(1);
    }

    console.log(chalk.green(`✓ Found project: ${targetProject.title} (#${targetProject.number})`));

    // Load project items to provide context
    const projectsAPI = new GitHubProjectsAPI(targetProject.id, config.project as ProjectConfig);
    const items = await projectsAPI.getAllItems();

    console.log(chalk.gray(`  Current items: ${items.length}`));

    // Build context about current project structure
    const projectContext = items.map(item => {
      const status = item.fieldValues['Status'] || 'No Status';
      const phase = item.fieldValues['Epic'] || item.fieldValues['Phase'] || 'No Phase';
      return `- #${item.content.number}: ${item.content.title} [${status}] (${phase})`;
    }).join('\n');

    const llmProvider = 'claude';
    const llmConfig = config.llms[llmProvider];
    const claudePath = llmConfig.cliPath || 'claude';

    // Build modification prompt with /sc:design directive
    const designPrompt = `/sc:design

Modify GitHub Project #${projectNumber}: "${targetProject.title}"

Current project structure:
${projectContext}

Modification request:
${description}

Please provide a design for the modifications needed. This should include:
1. New issues to create (if any)
2. Issues to modify (if any)
3. Issues to close (if any)
4. Updated phase structure (if applicable)

Format the output as actionable changes to the GitHub Project.`;

    console.log(chalk.cyan('🤖 Generating project modifications with Claude...\n'));

    // Use spawn to run Claude interactively
    const { spawn } = await import('child_process');

    const proc = spawn(claudePath, [], {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        CLAUDE_PROMPT: designPrompt,
      },
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(chalk.green('\n✓ Project modification design completed!'));
        console.log(chalk.gray('\nReview the proposed changes and apply them manually to project:'));
        console.log(chalk.gray(`  ${targetProject.url}`));
      } else {
        console.error(chalk.red(`\n✗ Claude exited with code ${code}`));
        process.exit(1);
      }
    });

  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error modifying project:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}
