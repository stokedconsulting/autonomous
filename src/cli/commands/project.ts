/**
 * Project command implementation
 *
 * Subcommands:
 * - init: Initialize project configuration
 * - status: Show project status
 * - list-ready: List ready items for assignment
 */

import chalk from 'chalk';
import { promises as fs } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { ConfigManager } from '../../core/config-manager.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { ProjectFieldMapper } from '../../github/project-field-mapper.js';
import { ProjectAwarePrioritizer } from '../../core/project-aware-prioritizer.js';
import { IssueEvaluator } from '../../core/issue-evaluator.js';
import { AssignmentManager } from '../../core/assignment-manager.js';

interface ProjectStatusOptions {
  json?: boolean;
  verbose?: boolean;
}

interface ProjectListReadyOptions {
  limit?: number;
  json?: boolean;
  verbose?: boolean;
}

interface ProjectInitOptions {
  projectNumber?: number;
  projectId?: string;
  org?: boolean;
}

/**
 * Project init - Initialize project configuration
 */
export async function projectInitCommand(options: ProjectInitOptions): Promise<void> {
  try {
    const cwd = process.cwd();
    const configPath = join(cwd, '.autonomous-config.json');

    console.log(chalk.blue('🚀 Initializing GitHub Projects integration\n'));

    // Check if config exists
    let configExists = false;
    try {
      await fs.access(configPath);
      configExists = true;
    } catch {
      // Config doesn't exist
    }

    if (!configExists) {
      console.error(chalk.red('✗ No .autonomous-config.json found'));
      console.log('Run "autonomous setup" first to create base configuration.');
      process.exit(1);
    }

    const configManager = new ConfigManager(cwd);
    const config = configManager.getConfig();

    // Get project ID if not provided
    let projectId = options.projectId;

    if (!projectId && options.projectNumber) {
      const owner = config.github.owner;
      const isOrg = options.org !== undefined ? options.org : true;

      console.log(chalk.gray(`Looking up project #${options.projectNumber}...`));

      // Query to get project ID
      const entityType = isOrg ? 'organization' : 'user';
      const query = [
        'query {',
        `  ${entityType}(login: "${owner}") {`,
        `    projectV2(number: ${options.projectNumber}) {`,
        '      id',
        '      title',
        '      url',
        '    }',
        '  }',
        '}',
      ].join(' ');

      const result = execSync('gh api graphql -f query=\'' + query.replace(/'/g, "'\\''") + '\'', {
        encoding: 'utf-8',
      });

      const data = JSON.parse(result);
      const projectData = isOrg
        ? data.data.organization?.projectV2
        : data.data.user?.projectV2;

      if (!projectData) {
        console.error(chalk.red(`✗ Project #${options.projectNumber} not found`));
        process.exit(1);
      }

      projectId = projectData.id;

      console.log(chalk.green(`✓ Found project: ${projectData.title}`));
      console.log(chalk.gray(`  URL: ${projectData.url}`));
      console.log(chalk.gray(`  ID: ${projectId}\n`));
    }

    if (!projectId) {
      console.error(chalk.red('✗ Either --project-number or --project-id is required'));
      process.exit(1);
    }

    // Test connection
    console.log(chalk.gray('Testing project connection...'));

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project!);
    const fields = await projectsAPI.getFields();

    console.log(chalk.green(`✓ Connected successfully`));
    console.log(chalk.gray(`  Found ${fields.length} project fields\n`));

    // Display fields
    console.log(chalk.blue('Project Fields:'));
    fields.forEach((field) => {
      console.log(chalk.gray(`  - ${field.name} (${field.dataType})`));
      if (field.options && field.options.length > 0 && field.options.length <= 10) {
        field.options.forEach((opt) => {
          console.log(chalk.gray(`    • ${opt.name}`));
        });
      }
    });

    console.log(chalk.green('\n✓ Project integration initialized successfully!'));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  1. Review project configuration in .autonomous-config.json'));
    console.log(chalk.gray('  2. Run "autonomous project status" to see project status'));
    console.log(chalk.gray('  3. Run "autonomous project list-ready" to see ready items'));
  } catch (error: any) {
    console.error(chalk.red('\n✗ Error initializing project:'), error.message);
    if (error.stderr) {
      console.error(chalk.gray(error.stderr));
    }
    process.exit(1);
  }
}

/**
 * Project status - Show project status
 */
export async function projectStatusCommand(options: ProjectStatusOptions): Promise<void> {
  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);
    const config = configManager.getConfig();

    if (!config.project?.enabled) {
      console.error(chalk.red('✗ Project integration is not enabled'));
      console.log('Run "autonomous project init" first.');
      process.exit(1);
    }

    // Get project ID from environment or config
    const projectId = process.env.GITHUB_PROJECT_ID || 'PVT_kwDOBW_6Ns4BGTch'; // TODO: Store in config

    console.log(chalk.blue('📊 Project Status\n'));

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
    const assignmentManager = new AssignmentManager(cwd, { projectAPI: projectsAPI });

    // Load assignments
    try {
      await assignmentManager.load();
    } catch {
      // No assignments file yet
    }

    const allAssignments = assignmentManager.getAllAssignments();

    // Query project items
    console.log(chalk.gray('Querying project items...\n'));

    const result = await projectsAPI.queryItems({ limit: 100 });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            totalItems: result.totalCount,
            items: result.items,
            assignments: allAssignments,
          },
          null,
          2
        )
      );
      return;
    }

    // Group items by status
    const byStatus: Record<string, number> = {};
    const statusFieldName = config.project.fields.status.fieldName;

    result.items.forEach((item) => {
      const status = item.fieldValues[statusFieldName] || 'No Status';
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    console.log(chalk.bold('Project Items by Status:'));
    Object.entries(byStatus)
      .sort(([, a], [, b]) => b - a)
      .forEach(([status, count]) => {
        const color =
          status === 'Done'
            ? 'green'
            : status === 'In Progress'
              ? 'yellow'
              : status === 'Blocked'
                ? 'red'
                : 'gray';
        console.log(`  ${chalk[color](`${status}:`)} ${count}`);
      });

    console.log(chalk.gray(`\nTotal items: ${result.totalCount}`));

    // Show ready items count
    const readyItems = result.items.filter((item) =>
      config.project!.fields.status.readyValues.includes(item.fieldValues[statusFieldName])
    );

    console.log(chalk.blue(`\nReady for assignment: ${readyItems.length}`));

    // Show local assignments
    console.log(chalk.bold('\nLocal Assignments:'));
    if (allAssignments.length === 0) {
      console.log(chalk.gray('  No assignments yet'));
    } else {
      const localByStatus: Record<string, number> = {};
      allAssignments.forEach((a) => {
        localByStatus[a.status] = (localByStatus[a.status] || 0) + 1;
      });

      Object.entries(localByStatus).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });
    }

    if (options.verbose) {
      console.log(chalk.blue('\n\nReady Items:'));
      readyItems.slice(0, 10).forEach((item) => {
        const priority = item.fieldValues['Priority'] || 'No Priority';
        const size = item.fieldValues['Size'] || 'No Size';
        console.log(
          chalk.gray(`  #${item.content.number} - ${item.content.title}`)
        );
        console.log(chalk.gray(`    Priority: ${priority}, Size: ${size}`));
      });

      if (readyItems.length > 10) {
        console.log(chalk.gray(`  ... and ${readyItems.length - 10} more`));
      }
    }
  } catch (error: any) {
    console.error(chalk.red('\n✗ Error getting project status:'), error.message);
    process.exit(1);
  }
}

/**
 * Project list-ready - List ready items with hybrid prioritization
 */
export async function projectListReadyCommand(options: ProjectListReadyOptions): Promise<void> {
  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);
    const config = configManager.getConfig();

    if (!config.project?.enabled) {
      console.error(chalk.red('✗ Project integration is not enabled'));
      console.log('Run "autonomous project init" first.');
      process.exit(1);
    }

    // Get project ID
    const projectId = process.env.GITHUB_PROJECT_ID || 'PVT_kwDOBW_6Ns4BGTch'; // TODO: Store in config

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
    const fieldMapper = new ProjectFieldMapper(projectsAPI, config.project);
    const prioritizer = new ProjectAwarePrioritizer(config.project, fieldMapper);

    console.log(chalk.blue('📋 Ready Items for Assignment\n'));
    console.log(chalk.gray('Loading project items and AI evaluations...\n'));

    // Get ready items from project
    const readyItems = await fieldMapper.getReadyItemsWithMetadata();

    if (readyItems.length === 0) {
      console.log(chalk.yellow('No ready items found in project.'));
      console.log('Items must have Status = "Ready" or "Todo" to be listed.');
      return;
    }

    // Load AI evaluations
    const issueEvaluator = new IssueEvaluator(cwd);
    await issueEvaluator.loadCache();

    const evaluations = readyItems
      .map((item) => issueEvaluator.getEvaluation(item.issueNumber))
      .filter((e) => e !== null);

    if (evaluations.length === 0) {
      console.log(chalk.yellow('No AI evaluations found for ready items.'));
      console.log('Run "autonomous evaluate" first to evaluate issues.');
      return;
    }

    // Get project metadata for all issues
    const issueNumbers = evaluations.map((e) => e!.issueNumber);
    const metadataMap = await fieldMapper.getMetadataForIssues(issueNumbers);

    // Calculate hybrid priorities
    const prioritized = prioritizer.prioritizeIssues(evaluations as any, metadataMap);

    const limit = options.limit || prioritized.length;
    const displayItems = prioritized.slice(0, limit);

    if (options.json) {
      console.log(JSON.stringify(displayItems, null, 2));
      return;
    }

    console.log(chalk.bold('Hybrid Prioritization (AI + Project):\n'));

    displayItems.forEach((item, idx) => {
      const ctx = item.context;
      const scoreColor =
        item.hybridScore >= 7
          ? 'green'
          : item.hybridScore >= 5
            ? 'yellow'
            : 'gray';

      console.log(
        chalk[scoreColor](
          `${idx + 1}. #${item.issueNumber} - Score: ${item.hybridScore.toFixed(2)}`
        )
      );
      console.log(chalk.gray(`   ${item.issueTitle}`));

      if (options.verbose) {
        console.log(
          chalk.gray(
            `   AI: ${ctx.aiPriorityScore.toFixed(1)} | Project: ${ctx.projectPriority || 'N/A'} | Size: ${ctx.projectSize || 'N/A'} | Sprint: ${ctx.projectSprint?.title || 'N/A'}`
          )
        );
        console.log(
          chalk.gray(
            `   Complexity: ${ctx.complexity} | Impact: ${ctx.impact} | Clarity: ${ctx.clarity.toFixed(1)}`
          )
        );
      } else {
        console.log(
          chalk.gray(
            `   AI: ${ctx.aiPriorityScore.toFixed(1)} | Priority: ${ctx.projectPriority || 'N/A'} | Size: ${ctx.projectSize || 'N/A'}`
          )
        );
      }

      console.log('');
    });

    if (prioritized.length > limit) {
      console.log(chalk.gray(`... and ${prioritized.length - limit} more`));
    }

    console.log(
      chalk.blue(
        `\nShowing ${displayItems.length} of ${prioritized.length} ready items`
      )
    );

    if (options.verbose && displayItems.length > 0) {
      console.log(chalk.blue('\nPrioritization breakdown for top item:'));
      console.log(prioritizer.getPrioritizationBreakdown(displayItems[0].context));
    }
  } catch (error: any) {
    console.error(chalk.red('\n✗ Error listing ready items:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}
