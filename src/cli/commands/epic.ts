/**
 * Epic command - Manage epic workflows and phased projects
 */

import { ConfigManager } from '../../core/config-manager.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { Octokit } from '@octokit/rest';
import chalk from 'chalk';
import { hasGitHubToken } from '../../utils/github-token.js';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';

interface EpicCreateOptions {
  name: string;
  requirements?: string;
  designFile?: string;
}

interface PhaseItem {
  title: string;
  body: string;
  isMaster: boolean;
  phase: string;
  phaseNumber: number;
  workNumber?: number;
}

/**
 * Parse design output into phase structure
 */
function parseDesignOutput(designText: string, epicName: string): PhaseItem[] {
  const items: PhaseItem[] = [];

  // Extract phase sections
  const phasePattern = /## Phase (\d+):?\s*(.+?)\n([\s\S]*?)(?=\n## Phase \d+|$)/gi;
  let match;

  while ((match = phasePattern.exec(designText)) !== null) {
    const phaseNumber = parseInt(match[1]);
    const phaseName = match[2].trim().replace(/ - MASTER$/i, '');
    const phaseContent = match[3];

    // Create phase master item
    items.push({
      title: `[${epicName}] Phase ${phaseNumber}: ${phaseName} - MASTER`,
      body: `# Phase ${phaseNumber}: ${phaseName}\n\n${phaseContent.substring(0, 500)}...`,
      isMaster: true,
      phase: `Phase ${phaseNumber}`,
      phaseNumber,
    });

    // Extract work items from phase content
    const workPattern = /(?:^|\n)(?:###?\s*)?(?:Phase\s*\d+\.)?(\d+)[\.\)]\s*(.+?)(?:\n|$)/gi;
    let workMatch;
    let workNumber = 1;

    while ((workMatch = workPattern.exec(phaseContent)) !== null) {
      const workTitle = workMatch[2].trim();

      // Extract description/body for this work item (next few lines until next item or end)
      const workStartIndex = workMatch.index + workMatch[0].length;
      const nextWorkMatch = workPattern.exec(phaseContent);
      const workEndIndex = nextWorkMatch ? nextWorkMatch.index : phaseContent.length;
      workPattern.lastIndex = workMatch.index + workMatch[0].length; // Reset for next iteration

      const workBody = phaseContent.substring(workStartIndex, workEndIndex).trim().substring(0, 1000);

      items.push({
        title: `[${epicName}] (Phase ${phaseNumber}.${workNumber}) ${workTitle}`,
        body: workBody || `Work item for Phase ${phaseNumber}: ${phaseName}`,
        isMaster: false,
        phase: `Phase ${phaseNumber}`,
        phaseNumber,
        workNumber,
      });

      workNumber++;
    }
  }

  return items;
}

/**
 * Create GitHub issues for epic items
 */
async function createEpicIssues(
  items: PhaseItem[],
  epicName: string,
  octokit: Octokit,
  owner: string,
  repo: string,
  projectsAPI: GitHubProjectsAPI,
  projectNumber: number
): Promise<void> {
  console.log(chalk.cyan(`\n📝 Creating ${items.length} issues for epic "${epicName}"...\n`));

  for (const item of items) {
    const itemType = item.isMaster ? 'MASTER' : 'work item';
    console.log(chalk.gray(`  Creating ${itemType}: ${item.title}`));

    try {
      // Create GitHub issue
      const { data: issue } = await octokit.issues.create({
        owner,
        repo,
        title: item.title,
        body: item.body,
        labels: [],
      });

      console.log(chalk.green(`    ✓ Created issue #${issue.number}`));

      // Add to project using gh CLI
      console.log(chalk.gray(`    Adding to project...`));
      const issueUrl = `https://github.com/${owner}/${repo}/issues/${issue.number}`;
      execSync(`gh project item-add ${projectNumber} --owner ${owner} --url "${issueUrl}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Get project item ID
      const projectItemId = await projectsAPI.getProjectItemIdByIssue(issue.number);
      if (!projectItemId) {
        console.error(chalk.red(`    ✗ Could not get project item ID for issue #${issue.number}`));
        continue;
      }

      // Set epic field (text field)
      await projectsAPI.updateItemTextField(projectItemId, 'Epic', epicName);

      // Set phase field (text field)
      await projectsAPI.updateItemTextField(projectItemId, 'Phase', item.phase);

      // Set type field for master items (single-select field)
      if (item.isMaster) {
        await projectsAPI.updateItemFieldValue(projectItemId, 'Type', 'Epic');
      }

      // Set status to Ready
      await projectsAPI.updateItemStatusByValue(projectItemId, 'Ready');

      console.log(chalk.green(`    ✓ Added to project with epic="${epicName}", phase="${item.phase}"`));

    } catch (error) {
      console.error(chalk.red(`    ✗ Failed to create issue: ${error}`));
    }
  }

  console.log(chalk.green.bold(`\n✅ Epic "${epicName}" created successfully with ${items.length} issues!\n`));
}

/**
 * Create a new epic with phased structure
 */
export async function createEpicCommand(epicRequirements: string, options: EpicCreateOptions): Promise<void> {
  try {
    const cwd = process.cwd();

    // Load configuration
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    // Validate GitHub token
    if (!hasGitHubToken(config.github.token)) {
      console.error(chalk.red('\n✗ GitHub token not found'));
      console.log(chalk.yellow('\nPlease authenticate with GitHub:'));
      console.log('  gh auth login');
      process.exit(1);
    }

    // Validate project configuration
    if (!config.project?.enabled) {
      console.error(chalk.red('\n✗ GitHub Project not configured'));
      console.log(chalk.yellow('\nPlease configure your project:'));
      console.log('  auto config project --project-number <number>');
      process.exit(1);
    }

    console.log(chalk.blue.bold(`\n🎯 Creating Epic: ${options.name}\n`));

    // Initialize GitHub API
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
      throw new Error('GitHub token not found in environment');
    }

    const octokit = new Octokit({ auth: token });

    // Resolve project ID from project number
    const { resolveProjectId } = await import('../../github/project-resolver.js');
    const projectId = await resolveProjectId(
      config.github.owner,
      config.github.repo,
      false // don't show messages
    );

    if (!projectId) {
      throw new Error('Could not resolve project ID');
    }

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);

    // Step 1: Generate design or load from file
    let designText: string;

    if (options.designFile) {
      console.log(chalk.cyan(`📖 Loading design from file: ${options.designFile}\n`));
      designText = await fs.readFile(options.designFile, 'utf-8');
    } else {
      // Generate design prompt for /sc:design
      console.log(chalk.cyan('📋 Generating phased project design...\n'));

      const designPrompt = `Epic: ${options.name}

Requirements:
${epicRequirements}

Create a detailed phased implementation plan with:
- 3-7 logical phases
- Each phase has a master item and 2-6 work items
- Clear phase structure with concrete, implementable tasks
- Technical details and acceptance criteria for each item

Format as:
## Phase N: Phase Name
### Phase N.1) Work Item Title
Description and details...
### Phase N.2) Another Work Item
Description and details...`;

      console.log(chalk.yellow('⚠️  Please create the design manually:\n'));
      console.log(chalk.gray('1. Run: /sc:design'));
      console.log(chalk.gray('2. Provide this prompt:\n'));
      console.log(chalk.cyan(designPrompt));
      console.log(chalk.gray('\n3. Save the output to a file'));
      console.log(chalk.gray('4. Run: auto epic create --name "' + options.name + '" --design-file <path>\n'));
      return;
    }

    // Step 2: Parse design into phase structure
    console.log(chalk.cyan('🔍 Parsing phase structure...\n'));
    const items = parseDesignOutput(designText, options.name);

    console.log(chalk.gray(`  Found ${items.filter(i => i.isMaster).length} phase masters`));
    console.log(chalk.gray(`  Found ${items.filter(i => !i.isMaster).length} work items\n`));

    // Step 3: Create all issues and add to project
    await createEpicIssues(
      items,
      options.name,
      octokit,
      config.github.owner,
      config.github.repo,
      projectsAPI,
      config.project.projectNumber!
    );

  } catch (error) {
    console.error(chalk.red('\n✗ Epic creation failed:'), error);
    process.exit(1);
  }
}

/**
 * Main epic command handler
 */
export async function epicCommand(subcommand: string, args: string[], options: any): Promise<void> {
  if (subcommand === 'create') {
    const epicRequirements = args.join(' ');

    if (!options.name) {
      console.error(chalk.red('\n✗ Epic name is required'));
      console.log(chalk.yellow('Usage: auto epic create --name "Epic Name" [requirements]'));
      process.exit(1);
    }

    if (!epicRequirements) {
      console.error(chalk.red('\n✗ Epic requirements are required'));
      console.log(chalk.yellow('Usage: auto epic create --name "Epic Name" <requirements>'));
      process.exit(1);
    }

    await createEpicCommand(epicRequirements, options);
  } else {
    console.error(chalk.red(`\n✗ Unknown subcommand: ${subcommand}`));
    console.log(chalk.yellow('\nAvailable subcommands:'));
    console.log('  create - Create a new phased epic');
    process.exit(1);
  }
}