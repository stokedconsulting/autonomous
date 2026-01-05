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
import { ResponseTracker, ResponseWatcher } from '../../utils/response-tracker.js';
import { getLatestFailedReviewFeedback } from '../../utils/review-feedback.js';
import {
  generateProjectPlan,
  refineProjectPlan,
  parseProjectPlan,
  createProjectIssues
} from '../../services/project-creation.js';
import { renderProjectCreation } from '../../ui/apps/index.js';
import { groupItemsByPhase } from '../../utils/phase-dependencies.js';

function hasStderr(error: unknown): error is { stderr: string } {
  return typeof error === 'object' && error !== null && 'stderr' in error;
}

interface ProjectCommandOptions {
  verbose?: boolean;
  limit?: number;
  all?: boolean;
  phases?: boolean;  // Show phases with no Ready sub-tasks
  sparse?: boolean;  // Show minimal view without phase items
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

    // Show phase details by default unless --sparse is set
    const showPhaseDetails = !options.sparse;

    // Define what statuses are considered "Ready" (work that can be started)
    const readyStatuses = new Set(['Ready', 'Todo', 'Evaluated', 'Failed Review']);
    // Define what statuses are considered "complete" (work finished)
    const doneStatuses = new Set(['Done', 'Merged', 'Closed']);
    // Define what statuses are considered "in progress" (actively being worked on)
    const inProgressStatuses = new Set(['In Progress', 'In Review']);

    // Track projects that were auto-updated to done (for accurate count)
    let autoUpdatedToDone = 0;
    let autoUpdatedToInProgress = 0;

    for (const project of filteredProjects) {
      const isValidated = validatedProjectNumbers.has(project.number);
      const prefix = isValidated ? chalk.green('✓ ') : '  ';
      const suffix = isValidated ? chalk.gray(' (validated)') : '';

      // Fetch items and check for auto-updates BEFORE displaying
      let shouldSkipDisplay = false;
      let projectsAPI: GitHubProjectsAPI | null = null;
      let sortedPhases: ReturnType<typeof groupItemsByPhase> extends Map<any, infer V> ? V[] : never[] = [];
      let statusFieldName = 'Status';

      if (showPhaseDetails && config.project) {
        try {
          projectsAPI = new GitHubProjectsAPI(project.id, config.project as ProjectConfig);
          const token = await getGitHubToken();
          const githubAPI = new GitHubAPI(token, config.github.owner, config.github.repo);
          const items = await projectsAPI.getAllItems();
          const phases = groupItemsByPhase(items);
          statusFieldName = config.project.fields?.status?.fieldName || 'Status';

          // Track issues closed during this processing
          let issuesClosedCount = 0;

          // Sort phases by phase number
          sortedPhases = Array.from(phases.values())
            .sort((a, b) => a.phaseNumber - b.phaseNumber);

          // AUTO-UPDATE: Check and update phase masters when all sub-items are Done
          let allProjectItemsDone = items.length > 0;
          for (const phase of sortedPhases) {
            // Check if all work items in this phase are Done
            const allWorkItemsDone = phase.workItems.length > 0 &&
              phase.workItems.every(item => doneStatuses.has(item.fieldValues[statusFieldName]));

            // If all work items are Done but master is not Done, update it
            if (allWorkItemsDone && phase.masterItem) {
              const masterStatus = phase.masterItem.fieldValues[statusFieldName];
              if (!doneStatuses.has(masterStatus)) {
                try {
                  await projectsAPI.updateItemStatusByValue(phase.masterItem.id, 'Done');
                  if (options.verbose) {
                    console.log(chalk.green(`  ✓ Auto-updated ${phase.phaseName} master to Done (project #${project.number})`));
                  }
                  // Update local state for display
                  phase.masterItem.fieldValues[statusFieldName] = 'Done';
                } catch (updateErr) {
                  if (options.verbose) {
                    console.log(chalk.yellow(`  ⚠ Could not auto-update ${phase.phaseName} master: ${updateErr instanceof Error ? updateErr.message : 'Unknown error'}`));
                  }
                }
              }
            }

            // Track if all items in project are done (work items + masters)
            const phaseComplete = allWorkItemsDone &&
              (!phase.masterItem || doneStatuses.has(phase.masterItem.fieldValues[statusFieldName]));
            if (!phaseComplete) {
              allProjectItemsDone = false;
            }
          }

          // Also check items not in phases
          const itemsInPhases = new Set(
            sortedPhases.flatMap(p => [...p.workItems.map(i => i.id), p.masterItem?.id].filter(Boolean))
          );
          const orphanItems = items.filter(i => !itemsInPhases.has(i.id));
          if (orphanItems.some(i => !doneStatuses.has(i.fieldValues[statusFieldName]))) {
            allProjectItemsDone = false;
          }

          // Check if any items are in progress
          const hasItemsInProgress = items.some(item =>
            inProgressStatuses.has(item.fieldValues[statusFieldName])
          );

          // AUTO-UPDATE: Add [Done] prefix to project title if all items are Done
          if (allProjectItemsDone && items.length > 0 && !project.title.startsWith('[Done]')) {
            try {
              // Remove [In Progress] prefix if present before adding [Done]
              let baseTitle = project.title;
              if (baseTitle.startsWith('[In Progress] - ')) {
                baseTitle = baseTitle.replace('[In Progress] - ', '');
              }
              const newTitle = `[Done] - ${baseTitle}`;
              await discovery.updateProjectTitle(project.id, newTitle);
              if (options.verbose) {
                console.log(chalk.green(`  ✓ Project #${project.number} marked as [Done] - all items complete`));
              }
              project.title = newTitle; // Update local reference
              autoUpdatedToDone++;

              // Skip displaying this project if --all is not set (it's now done)
              if (!options.all) {
                shouldSkipDisplay = true;
              }
            } catch (updateErr) {
              if (options.verbose) {
                console.log(chalk.yellow(`  ⚠ Could not mark project #${project.number} as Done: ${updateErr instanceof Error ? updateErr.message : 'Unknown error'}`));
              }
            }
          }

          // AUTO-UPDATE: Add [In Progress] prefix if any items are actively being worked on
          // Only if not already done and not already marked
          if (!allProjectItemsDone && hasItemsInProgress &&
              !project.title.startsWith('[Done]') &&
              !project.title.startsWith('[In Progress]')) {
            try {
              const newTitle = `[In Progress] - ${project.title}`;
              await discovery.updateProjectTitle(project.id, newTitle);
              if (options.verbose) {
                console.log(chalk.blue(`  ✓ Project #${project.number} marked as [In Progress] - work in progress`));
              }
              project.title = newTitle; // Update local reference
              autoUpdatedToInProgress++;
            } catch (updateErr) {
              if (options.verbose) {
                console.log(chalk.yellow(`  ⚠ Could not mark project #${project.number} as In Progress: ${updateErr instanceof Error ? updateErr.message : 'Unknown error'}`));
              }
            }
          }

          // AUTO-CLOSE: Close GitHub issues for items that are Done but still open
          for (const item of items) {
            const itemStatus = item.fieldValues[statusFieldName];
            const issueState = item.content.state;

            // If item is Done but issue is still open, close the issue
            if (doneStatuses.has(itemStatus) && issueState === 'open') {
              try {
                await githubAPI.closeIssue(item.content.number);
                issuesClosedCount++;
                if (options.verbose) {
                  console.log(chalk.green(`  ✓ Auto-closed issue #${item.content.number} (marked as ${itemStatus})`));
                }
              } catch (closeErr) {
                if (options.verbose) {
                  console.log(chalk.yellow(`  ⚠ Could not close issue #${item.content.number}: ${closeErr instanceof Error ? closeErr.message : 'Unknown error'}`));
                }
              }
            }
          }

          // Report issues closed (only if any were closed and not in verbose mode)
          if (issuesClosedCount > 0 && !options.verbose) {
            console.log(chalk.green(`  ✓ Auto-closed ${issuesClosedCount} issue(s) for project #${project.number}`));
          }
        } catch (err) {
          // Will show error when displaying
        }
      }

      // Skip display for newly-done projects (unless --all)
      if (shouldSkipDisplay) {
        continue;
      }

      // Now display the project
      console.log(`${prefix}${chalk.cyan(`#${project.number}`)} ${chalk.white(project.title)}${suffix}`);
      console.log(chalk.gray(`     ${project.url}`));

      // Show phase/item details
      if (showPhaseDetails && config.project && projectsAPI) {
        try {
          if (sortedPhases.length === 0) {
            console.log(chalk.gray('     No phases found'));
          } else {
            for (const phase of sortedPhases) {
              // For --phases: Show phases that have no Ready sub-tasks (work items with Ready status)
              if (options.phases) {
                const workItemsWithReady = phase.workItems.filter(item => {
                  const status = item.fieldValues[statusFieldName];
                  return readyStatuses.has(status);
                });

                // Only show phases with NO ready work items (meaning phase needs attention)
                if (workItemsWithReady.length === 0 && phase.workItems.length > 0) {
                  const masterStatus = phase.masterItem ?
                    phase.masterItem.fieldValues[statusFieldName] : 'No Master';
                  const completedCount = phase.workItems.filter(item => {
                    const status = item.fieldValues[statusFieldName];
                    return doneStatuses.has(status);
                  }).length;

                  console.log(chalk.yellow(`     📋 ${phase.phaseName}`));
                  console.log(chalk.gray(`        Master: ${masterStatus} | Items: ${completedCount}/${phase.workItems.length} done, 0 ready`));
                }
              } else {
                // Default: Show phases with their incomplete items indented
                const incompleteItems = phase.workItems.filter(item => {
                  const status = item.fieldValues[statusFieldName];
                  return !doneStatuses.has(status);
                });

                // Show phase header
                const masterStatus = phase.masterItem ?
                  phase.masterItem.fieldValues[statusFieldName] : null;
                const completedCount = phase.workItems.length - incompleteItems.length;

                console.log(chalk.cyan(`     📋 ${phase.phaseName}`) +
                  chalk.gray(` (${completedCount}/${phase.workItems.length} done)`) +
                  (masterStatus ? chalk.gray(` [Master: ${masterStatus}]`) : ''));

                // Show incomplete items indented
                for (const item of incompleteItems) {
                  const status = item.fieldValues[statusFieldName] || 'No Status';
                  const statusColor = readyStatuses.has(status) ? chalk.green : chalk.yellow;
                  console.log(chalk.gray(`        `) +
                    chalk.white(`#${item.content.number}`) +
                    chalk.gray(`: ${item.content.title.substring(0, 50)}${item.content.title.length > 50 ? '...' : ''}`) +
                    ` [${statusColor(status)}]`);
                }
              }
            }
          }
        } catch (err) {
          console.log(chalk.gray(`     ${chalk.yellow('⚠')} Could not fetch items: ${err instanceof Error ? err.message : 'Unknown error'}`));
        }
      }

      console.log('');
    }

    // Update the hidden count if we auto-updated any projects
    if (autoUpdatedToDone > 0 && !options.all) {
      console.log(chalk.gray(`(${autoUpdatedToDone} project(s) were auto-marked as [Done] and hidden)\n`));
    }

    // Show in-progress updates
    if (autoUpdatedToInProgress > 0) {
      console.log(chalk.blue(`(${autoUpdatedToInProgress} project(s) were marked as [In Progress])\n`));
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
  interactive?: boolean;  // Force Ink UI
  maxParallel?: number;   // Max parallel evaluations (default: 1)
  provider?: string;
  ui?: boolean;           // Disable UI when false (--no-ui)
  cu?: boolean;           // Claude Unlimited mode - autonomous loop until PROJECT COMPLETE
  ua?: boolean;           // Unattended Autonomous - interactive but auto-continues (DEFAULT)
  basic?: boolean;        // Basic Ink UI mode (old default)
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

  // Handle --cu mode: Claude Unlimited autonomous loop
  if (options.cu) {
    await projectStartWithClaudeUnlimited(projectIdentifier, options);
    return;
  }

  // Handle --basic mode: Use Ink UI (old default behavior)
  if (options.basic) {
    const hasTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    const shouldUseInkUI = options.ui !== false && hasTTY;

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
      }
    }
  }

  // DEFAULT: --ua mode (Unattended Autonomous - interactive Claude with auto-continue)
  // Also triggered explicitly with --ua flag
  const hasTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  if (hasTTY && options.ui !== false) {
    await projectStartWithUnattendedAutonomous(projectIdentifier, options);
    return;
  }

  // Non-TTY warning
  if (!hasTTY) {
    console.log(chalk.yellow('⚠️  TTY not detected; using text-only mode.'));
  }

  // Fallback to text-based mode for non-TTY environments

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
 * Start a project with Claude Unlimited - autonomous loop until PROJECT COMPLETE
 *
 * This mode:
 * 1. Runs `cldp project <projectNumber>` to start Claude working on the project
 * 2. When Claude finishes responding, checks if output contains "PROJECT COMPLETE"
 * 3. If not complete, sends "continue working on this project" to the same session
 * 4. Repeats until project is marked complete
 */
async function projectStartWithClaudeUnlimited(
  projectIdentifier: string,
  _options: ProjectStartOptions
): Promise<void> {
  const { spawn } = await import('child_process');
  const { randomUUID } = await import('crypto');
  const path = await import('path');
  const fs = await import('fs/promises');
  const os = await import('os');

  console.log(chalk.blue.bold('\n🔄 Starting Claude Unlimited Mode\n'));
  console.log(chalk.gray('This mode will autonomously continue working until PROJECT COMPLETE is detected.\n'));

  // Parse project number
  const projectNumber = parseInt(projectIdentifier);
  if (isNaN(projectNumber)) {
    console.error(chalk.red('Error: --cu mode requires a numeric project number.'));
    console.error(chalk.gray('Usage: auto project start --cu <project-number>'));
    process.exit(1);
  }

  // Generate a unique session ID for this autonomous run
  const sessionId = randomUUID();
  console.log(chalk.gray(`Session ID: ${sessionId}`));

  // Read the project prompt template
  const promptFile = path.join(os.homedir(), '.claude-prompt', 'project.prompt');
  let basePrompt: string;
  try {
    basePrompt = await fs.readFile(promptFile, 'utf-8');
  } catch (err) {
    console.error(chalk.red(`Error: Prompt file not found: ${promptFile}`));
    console.error(chalk.gray('Please create the prompt file with your project instructions.'));
    process.exit(1);
  }

  // Build the system prompt
  const systemPrompt = `IMPORTANT — PROJECT SELECTION IS NOT AMBIGUOUS.

You MUST operate ONLY on the GitHub Project with the following explicit number:

PROJECT NUMBER: ${projectNumber}

Do not attempt to infer or detect other project numbers. All work MUST be done inside this specific project.

---------------------------------------------------------------------

${basePrompt}

---------------------------------------------------------------------

AUTONOMOUS MODE INSTRUCTIONS:
When you have completed ALL work items in the project and there is nothing left to do,
you MUST end your response with the exact phrase: PROJECT COMPLETE

If there is still work remaining, do NOT include "PROJECT COMPLETE" in your response.`;

  const COMPLETION_MARKER = 'PROJECT COMPLETE';
  const MAX_ITERATIONS = 100; // Safety limit
  let iteration = 0;
  let isComplete = false;

  /**
   * Run Claude with the given prompt and return the output
   */
  async function runClaude(prompt: string, isResume: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const args: string[] = [
        '--print',
        '--dangerously-skip-permissions',
      ];

      if (isResume) {
        args.push('--resume', sessionId);
      } else {
        args.push('--session-id', sessionId);
        args.push('--append-system-prompt', systemPrompt);
      }

      args.push(prompt);

      console.log(chalk.cyan(`\n${'─'.repeat(60)}`));
      console.log(chalk.cyan.bold(`Iteration ${iteration + 1}${isResume ? ' (continuing)' : ' (starting)'}`));
      console.log(chalk.cyan(`${'─'.repeat(60)}\n`));

      const child = spawn('claude', args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text); // Stream output to terminal
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text);
      });

      child.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  try {
    // Initial prompt
    const initialPrompt = `Begin working on GitHub Project #${projectNumber}. Start by identifying the active Phase and its work items. Work through each item systematically.`;

    while (!isComplete && iteration < MAX_ITERATIONS) {
      const prompt = iteration === 0
        ? initialPrompt
        : `Continue working on this project. Pick up where you left off and complete the next task.

REMINDER: When ALL project work is finished, you MUST end your response with exactly:
PROJECT COMPLETE

This marker is required for automation to detect completion. Do not forget it.`;

      const output = await runClaude(prompt, iteration > 0);
      iteration++;

      // Check for completion marker
      if (output.includes(COMPLETION_MARKER)) {
        isComplete = true;
        console.log(chalk.green.bold(`\n${'═'.repeat(60)}`));
        console.log(chalk.green.bold('✅ PROJECT COMPLETE - Autonomous loop finished'));
        console.log(chalk.green.bold(`${'═'.repeat(60)}\n`));
        console.log(chalk.gray(`Total iterations: ${iteration}`));
        console.log(chalk.gray(`Session ID: ${sessionId}`));
      } else {
        console.log(chalk.yellow(`\n⏳ Iteration ${iteration} complete. No completion marker found. Continuing...`));

        // Small delay between iterations to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!isComplete) {
      console.log(chalk.yellow.bold(`\n⚠️ Maximum iterations (${MAX_ITERATIONS}) reached without completion.`));
      console.log(chalk.gray(`You can resume this session with: claude --resume ${sessionId}`));
    }

  } catch (error) {
    console.error(chalk.red('\n✗ Error in Claude Unlimited mode:'), error instanceof Error ? error.message : String(error));
    console.log(chalk.gray(`\nSession ID for debugging: ${sessionId}`));
    process.exit(1);
  }
}

/**
 * Start a project with Unattended Autonomous mode - interactive with auto-continue
 *
 * This mode:
 * 1. Runs Claude interactively so user can see and interact
 * 2. After each response, waits briefly for user input
 * 3. If no input within timeout, auto-sends continue message
 * 4. User can type custom messages anytime
 * 5. Continues until PROJECT COMPLETE is detected
 */
async function projectStartWithUnattendedAutonomous(
  projectIdentifier: string,
  _options: ProjectStartOptions
): Promise<void> {
  const { spawn } = await import('child_process');
  const { randomUUID } = await import('crypto');
  const path = await import('path');
  const fs = await import('fs/promises');
  const os = await import('os');
  const readline = await import('readline');

  console.log(chalk.blue.bold('\n🤖 Starting Unattended Autonomous Mode\n'));
  console.log(chalk.gray('Claude will run interactively - you\'ll see full TUI with thinking/tools.'));
  console.log(chalk.gray('Responses are logged to .autonomous/responses/ for history.'));
  console.log(chalk.gray('Type "done" after a session to stop, or just let it keep going.\n'));

  // Parse project number
  const projectNumber = parseInt(projectIdentifier);
  if (isNaN(projectNumber)) {
    console.error(chalk.red('Error: --ua mode requires a numeric project number.'));
    console.error(chalk.gray('Usage: auto project start --ua <project-number>'));
    process.exit(1);
  }

  // Generate a unique session ID for this autonomous run
  const sessionId = randomUUID();
  console.log(chalk.gray(`Session ID: ${sessionId}\n`));

  // Initialize response tracking for this session
  const autonomousDataDir = path.join(process.cwd(), '.autonomous');
  const responseTracker = new ResponseTracker(autonomousDataDir);
  await responseTracker.initSession(sessionId, `project-${projectNumber}`, process.cwd());

  // Create response watcher
  const responseWatcher = new ResponseWatcher(responseTracker, sessionId);
  await responseWatcher.start();

  console.log(chalk.gray(`Response history: .autonomous/responses/${sessionId}.json\n`));

  // Install the post-prompt hook for deterministic response detection
  const { generatePostPromptHook } = await import('../../utils/response-tracker.js');
  const claudeDir = path.join(process.cwd(), '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });

  // Create the post-prompt hook script
  const postPromptHookScript = generatePostPromptHook(autonomousDataDir, sessionId, `project-${projectNumber}`);
  const postPromptHookPath = path.join(hooksDir, 'autonomous-post-prompt.sh');
  await fs.writeFile(postPromptHookPath, postPromptHookScript, 'utf-8');
  await fs.chmod(postPromptHookPath, 0o755);

  // Register hook in settings.json
  const settingsPath = path.join(claudeDir, 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    const existingSettings = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(existingSettings);
  } catch {
    // No existing settings
  }

  // Configure hooks - Stop hook fires when Claude finishes responding
  settings.hooks = {
    ...((settings.hooks as Record<string, unknown>) || {}),
    Stop: [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command: postPromptHookPath,
          },
        ],
      },
    ],
  };
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  console.log(chalk.gray('Installed response tracking hook.\n'));

  // Set up response watcher event handlers
  let lastResponseCount = 0;
  responseWatcher.on('response', (response) => {
    lastResponseCount++;
    console.log(chalk.gray(`\n📝 Response ${lastResponseCount} captured at ${response.timestamp}`));
    if (response.hasCompletionSignal) {
      console.log(chalk.green('🎉 PROJECT COMPLETE signal detected!'));
    }
  });

  // Read the project prompt template
  const promptFile = path.join(os.homedir(), '.claude-prompt', 'project.prompt');
  let basePrompt: string;
  try {
    basePrompt = await fs.readFile(promptFile, 'utf-8');
  } catch (err) {
    console.error(chalk.red(`Error: Prompt file not found: ${promptFile}`));
    console.error(chalk.gray('Please create the prompt file with your project instructions.'));
    process.exit(1);
  }

  // Build the system prompt
  const systemPrompt = `IMPORTANT — PROJECT SELECTION IS NOT AMBIGUOUS.

You MUST operate ONLY on the GitHub Project with the following explicit number:

PROJECT NUMBER: ${projectNumber}

Do not attempt to infer or detect other project numbers. All work MUST be done inside this specific project.

---------------------------------------------------------------------

${basePrompt}

---------------------------------------------------------------------

AUTONOMOUS MODE INSTRUCTIONS:
When you have completed ALL work items in the project and there is nothing left to do,
you MUST end your response with the exact phrase: PROJECT COMPLETE

If there is still work remaining, do NOT include "PROJECT COMPLETE" in your response.`;

  const MAX_ITERATIONS = 100;
  const AUTO_CONTINUE_DELAY = 10000; // 10 seconds
  let iteration = 0;
  let isComplete = false;

  /**
   * Run Claude interactively with full TUI visible
   * Returns true if user wants to continue, false to stop
   */
  async function runClaudeInteractive(prompt: string, isResume: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      const args: string[] = [
        '--dangerously-skip-permissions',
      ];

      if (isResume) {
        args.push('--resume', sessionId);
      } else {
        args.push('--session-id', sessionId);
        args.push('--append-system-prompt', systemPrompt);
        args.push(prompt);
      }

      console.log(chalk.cyan(`\n${'━'.repeat(70)}`));
      console.log(chalk.cyan.bold(` 🔄 Iteration ${iteration + 1}${isResume ? ' (continuing)' : ' (starting)'}`));
      console.log(chalk.cyan(`${'━'.repeat(70)}\n`));

      // Run Claude with full interactive TUI
      const child = spawn('claude', args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit', // Full passthrough - user sees everything
      });

      child.on('error', (err) => {
        console.error(chalk.red(`Failed to start Claude: ${err.message}`));
        resolve(false);
      });

      child.on('close', (code) => {
        console.log(''); // New line after Claude exits
        if (code === 0 || code === null) {
          // Claude exited normally - ask if we should continue
          resolve(true);
        } else {
          console.log(chalk.yellow(`Claude exited with code ${code}`));
          resolve(false);
        }
      });
    });
  }

  /**
   * Wait for user input with timeout, returns user input or null for auto-continue
   */
  async function waitForInputWithTimeout(timeoutMs: number): Promise<string | null> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      let countdown = Math.ceil(timeoutMs / 1000);
      let resolved = false;

      const updatePrompt = () => {
        if (!resolved) {
          process.stdout.write(`\r${chalk.yellow(`⏳ Auto-continuing in ${countdown}s... `)}${chalk.gray('(type to override, Enter to continue now)')}`);
        }
      };

      updatePrompt();

      const timer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(timer);
          if (!resolved) {
            resolved = true;
            rl.close();
            console.log(chalk.cyan('\n\n→ Auto-continuing...'));
            resolve(null);
          }
        } else {
          updatePrompt();
        }
      }, 1000);

      rl.on('line', (input) => {
        if (!resolved) {
          resolved = true;
          clearInterval(timer);
          rl.close();
          resolve(input.trim() || null);
        }
      });

      // Handle Ctrl+C
      rl.on('close', () => {
        if (!resolved) {
          resolved = true;
          clearInterval(timer);
        }
      });
    });
  }

  // Initial prompt
  const initialPrompt = `Begin working on GitHub Project #${projectNumber}. Start by identifying the active Phase and its work items. Work through each item systematically.`;

  try {
    while (!isComplete && iteration < MAX_ITERATIONS) {
      // Run Claude interactively - user sees full TUI
      const shouldContinue = await runClaudeInteractive(initialPrompt, iteration > 0);
      iteration++;

      if (!shouldContinue) {
        console.log(chalk.yellow('\n⏹ Claude exited with error.'));
        break;
      }

      // Check response tracker for completion signal (deterministic detection via hook)
      const sessionHistory = await responseTracker.getHistory(sessionId);
      if (sessionHistory?.isComplete) {
        isComplete = true;
        console.log(chalk.green.bold(`\n${'═'.repeat(70)}`));
        console.log(chalk.green.bold(' 🎉 PROJECT COMPLETE detected via response tracker'));
        console.log(chalk.green.bold(`${'═'.repeat(70)}\n`));
        console.log(chalk.gray(`Total iterations: ${iteration}`));
        console.log(chalk.gray(`Session ID: ${sessionId}`));
        console.log(chalk.gray(`Responses captured: ${sessionHistory.responseCount}`));
        break;
      }

      // Check latest response for blocked/failed status
      const latestResponse = sessionHistory?.responses[sessionHistory.responses.length - 1];
      if (latestResponse?.isBlocked) {
        console.log(chalk.yellow.bold(`\n⚠️ BLOCKED: ${latestResponse.blockReason || 'Unknown reason'}`));
        console.log(chalk.gray('Session paused. You may need to intervene manually.'));
      }
      if (latestResponse?.isFailed) {
        console.log(chalk.red.bold(`\n❌ FAILED: ${latestResponse.failReason || 'Unknown reason'}`));
      }

      // After Claude exits (user pressed Esc), ask if we should continue
      console.log(chalk.gray(`\n${'─'.repeat(70)}`));
      console.log(chalk.cyan.bold('Claude session ended.'));
      console.log(chalk.gray('Type "done" if project is complete, or wait for auto-continue...'));

      const userInput = await waitForInputWithTimeout(AUTO_CONTINUE_DELAY);

      if (userInput !== null) {
        const input = userInput.toLowerCase().trim();
        if (input === 'done' || input === 'stop' || input === 'q' || input === 'quit') {
          isComplete = true;
          console.log(chalk.green.bold(`\n${'═'.repeat(70)}`));
          console.log(chalk.green.bold(' ✅ Session ended by user'));
          console.log(chalk.green.bold(`${'═'.repeat(70)}\n`));
          console.log(chalk.gray(`Total iterations: ${iteration}`));
          console.log(chalk.gray(`Session ID: ${sessionId}`));
          break;
        }
      }

      // Auto-continue with --resume
      console.log(chalk.cyan('\n→ Auto-resuming session...'));
    }

    if (!isComplete && iteration >= MAX_ITERATIONS) {
      console.log(chalk.yellow.bold(`\n⚠️ Maximum iterations (${MAX_ITERATIONS}) reached.`));
      console.log(chalk.gray(`You can resume this session with: claude --resume ${sessionId}`));
    }

    // Print response history summary
    const finalHistory = await responseTracker.getHistory(sessionId);
    if (finalHistory) {
      console.log(chalk.gray(`\n📊 Session Summary:`));
      console.log(chalk.gray(`   Responses captured: ${finalHistory.responseCount}`));
      console.log(chalk.gray(`   History file: .autonomous/responses/${sessionId}.json`));
    }

  } catch (error) {
    console.error(chalk.red('\n✗ Error in Unattended Autonomous mode:'), error instanceof Error ? error.message : String(error));
    console.log(chalk.gray(`\nSession ID for debugging: ${sessionId}`));
    process.exit(1);
  } finally {
    // Clean up response watcher
    responseWatcher.stop();
  }
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
