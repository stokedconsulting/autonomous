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
import { Assignment } from '../../types/assignments.js';
import { PrioritizedIssue } from '../../core/project-aware-prioritizer.js';

function hasStderr(error: unknown): error is { stderr: string } {
  return typeof error === 'object' && error !== null && 'stderr' in error;
}

interface ProjectCommandOptions {
  verbose?: boolean;
  limit?: number;
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

    // Ensure project config is set
    if (!config.project) {
      config.project = {
        enabled: true,
        projectNumber: parseInt(projectId),
        organizationProject: false, // Default to false, can be updated later.
        fields: {
          status: {
            fieldName: 'Status',
            readyValues: ['Todo', 'Ready', 'Evaluated'],
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
      config.project.projectNumber = parseInt(projectId);
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

    if (!config.project?.enabled || !config.project.projectNumber) {
      console.error(chalk.red('Error: GitHub Project integration not enabled or project ID not set.'));
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
    const fields = await projectsAPI.getFields();

    console.log(chalk.green(`✓ Connected to project: ${config.project.projectNumber}`));
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

    if (!config.project?.enabled || !config.project.projectNumber) {
      console.error(chalk.red('Error: GitHub Project integration not enabled or project ID not set.'));
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

    if (!config.project?.enabled || !config.project.projectNumber) {
      console.error(chalk.red('Error: GitHub Project integration not enabled or project ID not set.'));
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

    if (!config.project?.enabled || !config.project.projectNumber) {
      console.error(chalk.red('Error: GitHub Project integration not enabled or project ID not set.'));
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
    let result;
    if (options.all) {
      console.log(chalk.blue('Fetching ALL items from project...'));
      result = await projectsAPI.queryItems({ limit: 100 });
    } else {
      const targetStatus = options.status || 'In Review';
      console.log(chalk.blue(`Fetching items with status: ${targetStatus}...`));
      result = await projectsAPI.queryItems({
        status: [targetStatus],
        limit: 100,
      });
    }

    if (result.items.length === 0) {
      console.log(chalk.yellow('No items found'));
      return;
    }

    console.log(chalk.blue(`Found ${result.items.length} items. Backfilling metadata...\n`));

    let syncedCount = 0;
    let errorCount = 0;

    for (const item of result.items) {
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

    if (!config.project?.enabled || !config.project.projectNumber) {
      console.error(chalk.red('Error: GitHub Project integration not enabled or project ID not set.'));
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