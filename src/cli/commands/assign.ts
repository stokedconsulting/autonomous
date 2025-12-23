/**
 * Assign command - Manually assign a specific issue to autonomous processing
 */

import chalk from 'chalk';
import { basename } from 'path';
import { ConfigManager } from '../../core/config-manager.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { WorktreeManager } from '../../git/worktree-manager.js';
import { IssueEvaluator } from '../../core/issue-evaluator.js';
import { GitHubAPI } from '../../github/api.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { PromptBuilder } from '../../llm/prompt-builder.js';
import { ClaudeAdapter } from '../../llm/claude-adapter.js';
import { getGitHubToken } from '../../utils/github-token.js';
import { resolveProjectIdOrExit } from '../../github/project-resolver.js';
import { InstanceManager } from '../../core/instance-manager.js';
import { join } from 'path';
import { promises as fs } from 'fs';

interface AssignOptions {
  skipEval?: boolean;
  verbose?: boolean;
}

export async function assignCommand(issueNumber: string, options: AssignOptions): Promise<void> {
  console.log(chalk.blue.bold(`\n🎯 Assigning Issue #${issueNumber}\n`));

  try {
    const cwd = process.cwd();
    const projectName = basename(cwd);
    const issueNum = parseInt(issueNumber, 10);

    if (isNaN(issueNum)) {
      console.error(chalk.red('Error: Issue number must be a valid integer'));
      process.exit(1);
    }

    // Load configuration
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    // Get GitHub token
    const githubToken = await getGitHubToken(config.github.token);

    // Initialize managers
    const githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);

    // Initialize project API if enabled
    let projectsAPI: GitHubProjectsAPI | null = null;
    if (config.project?.enabled) {
      const projectId = await resolveProjectIdOrExit(config.github.owner, config.github.repo);
      projectsAPI = new GitHubProjectsAPI(projectId, config.project);
    }

    const assignmentManager = new AssignmentManager(cwd, {
      projectAPI: projectsAPI || undefined,
    });
    await assignmentManager.initialize(projectName, cwd);

    // Initialize instance manager for slot-based naming
    const maxSlots = {
      claude: config.llms.claude.maxConcurrentIssues,
      gemini: config.llms.gemini.maxConcurrentIssues,
      codex: config.llms.codex.maxConcurrentIssues,
    };
    const instanceManager = new InstanceManager(assignmentManager, maxSlots);

    // Check if issue is already assigned
    if (assignmentManager.isIssueAssigned(issueNum)) {
      const assignment = assignmentManager.getAllAssignments().find((a) => a.issueNumber === issueNum);
      console.log(chalk.yellow(`Issue #${issueNum} is already assigned (status: ${assignment?.status})`));
      console.log(chalk.gray(`Worktree: ${assignment?.worktreePath}`));
      return;
    }

    // Fetch issue from GitHub
    console.log(chalk.blue('Fetching issue from GitHub...'));
    const issue = await githubAPI.getIssue(issueNum);
    console.log(chalk.green(`✓ Found: ${issue.title}`));

    // Evaluate issue if not skipped
    if (!options.skipEval) {
      console.log(chalk.blue('\n📋 Evaluating issue...'));

      const claudePath = config.llms?.claude?.cliPath || 'claude';
      const issueEvaluator = new IssueEvaluator(claudePath, githubAPI);

      const { evaluated, skipped } = await issueEvaluator.evaluateIssues([issue], {
        verbose: options.verbose,
      });

      if (skipped.length > 0 && evaluated.length === 0) {
        console.log(chalk.yellow('\n⚠️  This issue may not have enough detail for autonomous work.'));
        console.log(chalk.yellow('Continuing anyway, but may require additional clarification...'));
      } else if (evaluated.length > 0) {
        const evaluation = evaluated[0];
        console.log(chalk.green('\n✓ Issue evaluation:'));
        console.log(chalk.gray(`  AI Priority: ${evaluation.scores.aiPriorityScore.toFixed(1)}/10`));
        console.log(chalk.gray(`  Complexity: ${evaluation.classification.complexity}`));
        console.log(chalk.gray(`  Impact: ${evaluation.classification.impact}`));
        console.log(chalk.gray(`  Estimated: ${evaluation.estimatedEffort}`));
      }
    }

    // Create worktree and branch
    console.log(chalk.blue('\n🌿 Setting up worktree...'));
    const worktreeManager = new WorktreeManager(cwd);

    // Generate branch name
    const slugTitle = issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
      
    const branchName = `${config.worktree.branchPrefix || 'feature/issue-'}${issueNum}-${slugTitle}`;

    // Check if worktree already exists
    const existingWorktreePath = join(
      cwd,
      config.worktree.baseDir || '..',
      config.worktree.namingPattern
        ?.replace('{projectName}', projectName)
        .replace('{number}', issueNum.toString()) || `${projectName}-issue-${issueNum}`
    );

    let worktreePath: string;
    try {
      await fs.access(existingWorktreePath);
      console.log(chalk.green(`✓ Worktree already exists: ${existingWorktreePath}`));
      worktreePath = existingWorktreePath;
    } catch {
      // Create new worktree
      const defaultBranch = await worktreeManager.getDefaultBranch();
      worktreePath = await worktreeManager.createWorktree({
        issueNumber: issueNum,
        branchName,
        baseDir: config.worktree.baseDir || '..',
        projectName,
        baseBranch: defaultBranch,
      });
      console.log(chalk.green(`✓ Worktree created: ${worktreePath}`));
    }

    // Get next available instance slot
    console.log(chalk.blue('\n🔍 Finding available instance slot...'));
    const availableSlot = instanceManager.getNextAvailableSlot('claude');

    if (!availableSlot) {
      console.error(
        chalk.red(
          `✗ No available Claude instances (max: ${config.llms.claude.maxConcurrentIssues})`
        )
      );
      console.log(chalk.yellow('Try increasing maxConcurrentIssues in .autonomous-config.json'));
      process.exit(1);
    }

    console.log(chalk.green(`✓ Assigned to slot: ${availableSlot.instanceId}`));

    // Detect if this is a phase master issue
    const isPhaseMaster = PromptBuilder.isPhaseMaster(issue.title);
    if (isPhaseMaster) {
      console.log(chalk.blue('📋 Phase Master detected - will use coordination workflow'));
    }

    // Create assignment
    console.log(chalk.blue('\n📝 Creating assignment...'));
    const assignment = await assignmentManager.createAssignment({
      issueNumber: issueNum,
      issueTitle: issue.title,
      issueBody: issue.body || undefined,
      llmProvider: 'claude', // Default to Claude
      worktreePath,
      branchName,
      requiresTests: config.requirements.testingRequired,
      requiresCI: config.requirements.ciMustPass,
      // NOTE: labels removed - read from GitHub/project instead
    });

    // Update assignment with slot-based instance ID and phase master flag
    await assignmentManager.updateAssignment(assignment.id, {
      llmInstanceId: availableSlot.instanceId,
    });
    assignment.llmInstanceId = availableSlot.instanceId; // Update in-memory reference

    // Set phase master flag in metadata
    if (isPhaseMaster && assignment.metadata) {
      assignment.metadata.isPhaseMaster = true;
      // No save needed - in-memory only
    }

    // Link assignment to project item if project integration enabled
    if (projectsAPI) {
      await assignmentManager.ensureProjectItemId(assignment.id);
      console.log(chalk.gray('✓ Linked to project'));

      // Update assigned instance field in project
      await assignmentManager.updateAssignedInstanceWithSync(
        assignment.id,
        availableSlot.instanceId
      );
    }

    // Generate initial prompt
    const prompt = PromptBuilder.buildInitialPrompt({
      assignment,
      worktreePath,
    });

    // Start Claude instance
    console.log(chalk.blue('\n🤖 Starting Claude instance...'));

    const autonomousDataDir = join(cwd, '.autonomous');
    await fs.mkdir(autonomousDataDir, { recursive: true });

    const claudeConfig = configManager.getLLMConfig('claude');
    const claudeAdapter = new ClaudeAdapter(claudeConfig, autonomousDataDir);

    await claudeAdapter.start({
      assignment,
      prompt,
      workingDirectory: worktreePath,
    });

    // Update assignment status (with project sync if enabled)
    if (projectsAPI) {
      await assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
    } else {
      await assignmentManager.updateAssignment(assignment.id, {
        status: 'in-progress',
      });
    }

    // Add work session
    await assignmentManager.addWorkSession(assignment.id, {
      startedAt: new Date().toISOString(),
      promptUsed: prompt,
    });

    console.log(chalk.green('\n✓ Assignment created successfully!'));
    console.log(chalk.gray(`\nWorktree: ${worktreePath}`));
    console.log(chalk.gray(`Branch: ${branchName}`));
    console.log(chalk.gray(`Instance ID: ${assignment.llmInstanceId}`));

    // Show log file location
    const logFile = join(autonomousDataDir, `output-${assignment.llmInstanceId}.log`);
    console.log(chalk.blue(`\n📊 Monitor progress:`));
    console.log(chalk.gray(`  tail -f ${logFile}`));
    console.log(chalk.gray(`  auto status`));
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error assigning issue:'), error instanceof Error ? error.message : String(error));
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}
