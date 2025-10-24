/**
 * Orchestrator - Coordinates LLM instances and manages the autonomous workflow
 */

import { ConfigManager } from './config-manager.js';
import { AssignmentManager } from './assignment-manager.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { IssueEvaluator } from './issue-evaluator.js';
import { GitHubAPI } from '../github/api.js';
import { GitHubProjectsAPI } from '../github/projects-api.js';
import { ProjectFieldMapper } from '../github/project-field-mapper.js';
import { ProjectAwarePrioritizer } from './project-aware-prioritizer.js';
import { LLMAdapter } from '../llm/adapter.js';
import { ClaudeAdapter } from '../llm/claude-adapter.js';
import { PromptBuilder } from '../llm/prompt-builder.js';
import { LLMProvider, Assignment, Issue } from '../types/index.js';
import { getGitHubToken } from '../utils/github-token.js';
import { resolveProjectId } from '../github/project-resolver.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

export class Orchestrator {
  private configManager: ConfigManager;
  private assignmentManager: AssignmentManager;
  private worktreeManager: WorktreeManager;
  private issueEvaluator: IssueEvaluator;
  private githubAPI: GitHubAPI | null = null;
  private projectsAPI: GitHubProjectsAPI | null = null;
  private fieldMapper: ProjectFieldMapper | null = null;
  private prioritizer: ProjectAwarePrioritizer | null = null;
  private adapters = new Map<LLMProvider, LLMAdapter>();
  private autonomousDataDir: string;
  private projectPath: string;
  private isRunning = false;
  private verbose: boolean;
  private logMonitors = new Map<string, any>(); // Store tail processes

  constructor(projectPath: string, configManager: ConfigManager, assignmentManager: AssignmentManager, verbose: boolean = false) {
    this.projectPath = projectPath;
    this.configManager = configManager;
    this.assignmentManager = assignmentManager;
    this.worktreeManager = new WorktreeManager(projectPath);
    this.autonomousDataDir = join(projectPath, '.autonomous');
    this.verbose = verbose;

    // Issue evaluator will be initialized in initialize() after githubAPI is ready
    const config = configManager.getConfig();
    const claudePath = config.llms?.claude?.cliPath || 'claude';
    this.issueEvaluator = new IssueEvaluator(projectPath, claudePath); // Temporary, will be re-initialized
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    // Create autonomous data directory
    await fs.mkdir(this.autonomousDataDir, { recursive: true });

    // Initialize GitHub API
    const config = this.configManager.getConfig();
    const githubToken = await getGitHubToken(config.github.token);

    this.githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);

    // Re-initialize issue evaluator with GitHubAPI
    const claudePath = config.llms?.claude?.cliPath || 'claude';
    this.issueEvaluator = new IssueEvaluator(this.projectPath, claudePath, this.githubAPI);

    // Initialize GitHub Projects v2 integration if enabled
    if (config.project?.enabled) {
      const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
      if (projectId) {
        this.projectsAPI = new GitHubProjectsAPI(projectId, config.project);
        this.fieldMapper = new ProjectFieldMapper(this.projectsAPI, config.project);
        this.prioritizer = new ProjectAwarePrioritizer(config.project, this.fieldMapper);

        // Ensure autonomous view exists with all required fields
        const claudeConfig = config.llms?.claude?.enabled ? {
          cliPath: config.llms.claude.cliPath || 'claude',
          cliArgs: config.llms.claude.cliArgs,
        } : undefined;
        await this.projectsAPI.ensureAutonomousView(claudeConfig);

        // Re-initialize assignment manager with project API for conflict detection
        this.assignmentManager = new AssignmentManager(this.projectPath, {
          projectAPI: this.projectsAPI,
        });

        console.log(chalk.green('✓ GitHub Projects v2 integration enabled'));
      } else {
        console.log(chalk.yellow('⚠ Project integration enabled but no project found'));
      }
    }

    // Verify git repository
    const isGitRepo = await this.worktreeManager.validateGitRepo();
    if (!isGitRepo) {
      throw new Error('Current directory is not a git repository');
    }

    // Initialize LLM adapters
    const enabledLLMs = this.configManager.getEnabledLLMs();

    for (const provider of enabledLLMs) {
      const llmConfig = this.configManager.getLLMConfig(provider);
      const adapter = this.createAdapter(provider, llmConfig);

      // Check if LLM is installed
      const isInstalled = await adapter.isInstalled();
      if (!isInstalled) {
        console.warn(chalk.yellow(`Warning: ${provider} CLI not found`));
        console.warn(chalk.gray(`  Searched for: ${llmConfig.cliPath || provider}`));
        console.warn(chalk.gray(`  If '${provider}' is a shell alias, use the full path instead:`));
        console.warn(chalk.gray(`  Run: which ${provider}  # to find the actual path`));
        console.warn(chalk.gray(`  Then: autonomous config add-llm ${provider} --cli-path /full/path/to/${provider}`));
      }

      this.adapters.set(provider, adapter);
    }
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    this.isRunning = true;

    console.log(chalk.blue('Fetching available issues from GitHub...'));

    // Fetch issues
    const issues = await this.fetchAvailableIssues();

    if (issues.length === 0) {
      console.log(chalk.yellow('No issues available for assignment.'));
      console.log('Make sure issues have the correct labels configured in .autonomous-config.json');
      return;
    }

    console.log(chalk.green(`Found ${issues.length} available issue(s)`));

    // Evaluate and prioritize issues
    const { evaluated, skipped } = await this.issueEvaluator.evaluateIssues(issues, {
      verbose: this.verbose,
    });

    // Report on skipped issues
    if (skipped.length > 0) {
      console.log(chalk.yellow('\n⚠️  Issues needing more detail:'));
      for (const issue of skipped) {
        const evaluation = this.issueEvaluator.getEvaluation(issue.number);
        console.log(chalk.gray(`  #${issue.number}: ${issue.title}`));
        if (evaluation?.suggestedQuestions && evaluation.suggestedQuestions.length > 0) {
          console.log(chalk.gray(`    Suggested questions:`));
          evaluation.suggestedQuestions.slice(0, 2).forEach((q) => {
            console.log(chalk.gray(`      - ${q}`));
          });
        }
      }
      console.log();
    }

    if (evaluated.length === 0) {
      console.log(chalk.yellow('No issues have enough detail for autonomous implementation.'));
      console.log('Please add more details to issues or answer the suggested questions above.');
      return;
    }

    // Use hybrid prioritization if project integration is enabled
    let issuesForAssignment: Issue[];

    if (this.prioritizer && this.fieldMapper) {
      console.log(chalk.blue('\n🎯 Calculating hybrid priorities (AI + Project)...'));

      // Get project metadata for all evaluated issues
      const issueNumbers = evaluated.map((e) => e.issueNumber);
      const projectMetadata = await this.fieldMapper.getMetadataForIssues(issueNumbers);

      // Calculate hybrid priorities
      const prioritized = this.prioritizer.prioritizeIssues(evaluated, projectMetadata);

      // Filter to only ready items (if using project status)
      const readyItems = this.prioritizer.filterReadyIssues(prioritized, projectMetadata);

      if (readyItems.length === 0) {
        console.log(chalk.yellow('No issues are in "Ready" status in the project.'));
        console.log('Please move issues to "Ready" status in the project board.');
        return;
      }

      console.log(chalk.blue('\n📊 Hybrid Priority Ranking:'));
      readyItems.slice(0, 5).forEach((item, idx) => {
        const ctx = item.context;
        console.log(
          chalk.cyan(
            `  ${idx + 1}. #${item.issueNumber} (Hybrid: ${item.hybridScore.toFixed(2)}) - ${ctx.projectPriority || 'No Priority'} - ${ctx.projectSize || 'No Size'}`
          )
        );
        console.log(chalk.gray(`     ${item.issueTitle}`));
        if (this.verbose) {
          console.log(
            chalk.gray(
              `     AI: ${ctx.aiPriorityScore.toFixed(1)} | Project: ${ctx.projectPriority || 'N/A'} | Sprint: ${ctx.projectSprint?.title || 'N/A'}`
            )
          );
        }
      });
      console.log();

      // Convert back to issues
      issuesForAssignment = readyItems.map((item) =>
        issues.find((i) => i.number === item.issueNumber)
      ).filter((i): i is Issue => i !== undefined);
    } else {
      // Fallback to AI-only prioritization
      // Issues are already sorted by AI priority from the evaluator
      issuesForAssignment = evaluated.map((evaluation) =>
        issues.find((i) => i.number === evaluation.issueNumber)
      ).filter((i): i is Issue => i !== undefined);

      console.log(chalk.blue('\n📊 AI Priority Ranking:'));
      evaluated.slice(0, 5).forEach((evaluation, idx) => {
        console.log(
          chalk.cyan(
            `  ${idx + 1}. #${evaluation.issueNumber} (AI: ${evaluation.scores.aiPriorityScore.toFixed(1)}/10) - ${evaluation.classification.complexity} complexity - ${evaluation.estimatedEffort}`
          )
        );
        console.log(chalk.gray(`     ${evaluation.issueTitle}`));
      });
      console.log();
    }

    // Assign issues to LLM instances (starting with highest priority)
    await this.assignIssues(issuesForAssignment);

    // Start monitoring loop
    this.startMonitoringLoop();
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // Stop all log monitors
    for (const monitor of this.logMonitors.values()) {
      try {
        monitor.kill();
      } catch (error) {
        // Ignore errors when killing monitors
      }
    }
    this.logMonitors.clear();

    // Stop all running LLM instances
    for (const [provider, adapter] of this.adapters) {
      const assignments = this.assignmentManager.getAssignmentsByProvider(provider);
      const activeAssignments = assignments.filter((a) => a.status === 'in-progress');

      for (const assignment of activeAssignments) {
        try {
          await adapter.stop(assignment.llmInstanceId);
        } catch (error) {
          console.error(chalk.red(`Error stopping ${provider} instance:`), error);
        }
      }
    }
  }

  /**
   * Dry run - simulate without starting LLMs
   */
  async dryRun(): Promise<void> {
    console.log(chalk.blue('Fetching available issues...'));

    const issues = await this.fetchAvailableIssues();

    if (issues.length === 0) {
      console.log(chalk.yellow('No issues available.'));
      return;
    }

    console.log(chalk.green(`\nFound ${issues.length} issue(s):\n`));

    issues.forEach((issue) => {
      console.log(`  #${issue.number}: ${issue.title}`);
      console.log(`    Labels: ${issue.labels.map((l) => l.name).join(', ')}`);
    });

    console.log(chalk.blue('\nWould assign issues to LLM instances:'));

    const enabledLLMs = this.configManager.getEnabledLLMs();
    for (const provider of enabledLLMs) {
      const llmConfig = this.configManager.getLLMConfig(provider);
      const maxConcurrent = llmConfig.maxConcurrentIssues;
      console.log(`  ${provider}: up to ${maxConcurrent} concurrent issue(s)`);
    }
  }

  /**
   * Fetch available issues from GitHub
   */
  private async fetchAvailableIssues() {
    if (!this.githubAPI) {
      throw new Error('GitHub API not initialized');
    }

    const config = this.configManager.getConfig();
    const issues = await this.githubAPI.getIssues({
      state: 'open',
      labels: config.github.labels,
    });

    // Filter out already assigned issues
    return issues.filter((issue) => !this.assignmentManager.isIssueAssigned(issue.number));
  }

  /**
   * Assign issues to LLM instances
   */
  private async assignIssues(issues: any[]): Promise<void> {
    const enabledLLMs = this.configManager.getEnabledLLMs();
    const config = this.configManager.getConfig();

    for (const provider of enabledLLMs) {
      const llmConfig = this.configManager.getLLMConfig(provider);
      const activeCount = this.assignmentManager.getActiveAssignmentsCount(provider);
      const available = llmConfig.maxConcurrentIssues - activeCount;

      if (available <= 0) {
        console.log(chalk.gray(`${provider}: at capacity (${activeCount}/${llmConfig.maxConcurrentIssues})`));
        continue;
      }

      // Assign up to 'available' issues to this provider
      const issuesToAssign = issues.splice(0, available);

      for (const issue of issuesToAssign) {
        await this.createAssignment(provider, issue, config.github.owner);
      }
    }
  }

  /**
   * Create and start an assignment
   */
  private async createAssignment(provider: LLMProvider, issue: any, projectName: string): Promise<void> {
    console.log(chalk.blue(`\nAssigning issue #${issue.number} to ${provider}...`));

    const config = this.configManager.getConfig();

    // Generate branch name
    const branchName = `${config.worktree.branchPrefix || 'feature/issue-'}${issue.number}-${this.slugify(issue.title)}`;

    // Create worktree
    console.log('Creating worktree...');
    const worktreePath = await this.worktreeManager.createWorktree({
      issueNumber: issue.number,
      branchName,
      baseDir: config.worktree.baseDir,
      projectName,
      baseBranch: await this.worktreeManager.getDefaultBranch(),
    });

    console.log(chalk.green(`✓ Worktree created: ${worktreePath}`));

    // Create assignment
    const assignment = await this.assignmentManager.createAssignment({
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body,
      llmProvider: provider,
      worktreePath,
      branchName,
      requiresTests: config.requirements.testingRequired,
      requiresCI: config.requirements.ciMustPass,
      // NOTE: labels removed - read from GitHub/project instead
    });

    // Link assignment to project item if project integration enabled
    if (this.projectsAPI) {
      await this.assignmentManager.ensureProjectItemId(assignment.id);
      console.log(chalk.gray('✓ Linked to project'));
    }

    // Generate initial prompt
    const prompt = PromptBuilder.buildInitialPrompt({
      assignment,
      worktreePath,
    });

    // Start LLM instance
    console.log('Starting LLM instance...');
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Adapter for ${provider} not found`);
    }

    await adapter.start({
      assignment,
      prompt,
      workingDirectory: worktreePath,
    });

    // Update assignment status (with project sync if enabled)
    if (this.projectsAPI) {
      await this.assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
    } else {
      await this.assignmentManager.updateAssignment(assignment.id, {
        status: 'in-progress',
      });
    }

    // Add work session
    await this.assignmentManager.addWorkSession(assignment.id, {
      startedAt: new Date().toISOString(),
      promptUsed: prompt,
    });

    console.log(chalk.green(`✓ Assignment created and ${provider} instance started`));

    // Start log monitoring in verbose mode
    if (this.verbose && assignment.llmInstanceId) {
      await this.startLogMonitoring(assignment.llmInstanceId, issue.number);
    }
  }

  /**
   * Monitoring loop
   */
  private async startMonitoringLoop(): Promise<void> {
    console.log(chalk.blue('\nStarting monitoring loop...\n'));

    while (this.isRunning) {
      await this.checkAssignments();
      await this.sleep(10000); // Check every 10 seconds
    }
  }

  /**
   * Check all active assignments
   */
  private async checkAssignments(): Promise<void> {
    const activeAssignments = this.assignmentManager.getAssignmentsByStatus('in-progress');

    for (const assignment of activeAssignments) {
      await this.checkAssignment(assignment);
    }

    // Check for completed assignments that need new issues
    const completedAssignments = this.assignmentManager.getAssignmentsByStatus('llm-complete');
    if (completedAssignments.length > 0) {
      // Fetch new issues and assign
      const issues = await this.fetchAvailableIssues();
      if (issues.length > 0) {
        await this.assignIssues(issues);
      }
    }
  }

  /**
   * Check a single assignment
   */
  private async checkAssignment(_assignment: Assignment): Promise<void> {
    // Check for session data / work completion
    // In a real implementation, this would check for hook callbacks
    // and determine if the LLM needs a new prompt

    // For now, log that we're monitoring
    // console.log(chalk.gray(`Monitoring ${assignment.llmProvider} on issue #${assignment.issueNumber}`));
  }

  /**
   * Create LLM adapter
   */
  private createAdapter(provider: LLMProvider, config: any): LLMAdapter {
    switch (provider) {
      case 'claude':
        return new ClaudeAdapter(config, this.autonomousDataDir);
      case 'gemini':
        throw new Error('Gemini adapter not implemented yet');
      case 'codex':
        throw new Error('Codex adapter not implemented yet');
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Slugify a string for branch names
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Start monitoring a log file and stream output
   */
  private async startLogMonitoring(instanceId: string, issueNumber: number): Promise<void> {
    const logFile = join(this.autonomousDataDir, `output-${instanceId}.log`);

    // Wait a moment for the log file to be created
    await this.sleep(1000);

    try {
      // Check if log file exists
      await fs.access(logFile);

      // Import spawn dynamically
      const { spawn } = await import('child_process');

      console.log(chalk.blue(`\n┌─ Issue #${issueNumber} (${instanceId}) ─────────────────────────────`));
      console.log(chalk.blue('│'));

      // Start tailing the log file
      const tail = spawn('tail', ['-f', logFile]);

      tail.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach((line: string) => {
          if (line.trim()) {
            console.log(chalk.blue('│ ') + line);
          }
        });
      });

      tail.stderr.on('data', (data) => {
        console.error(chalk.red('│ ERROR: ') + data.toString());
      });

      tail.on('close', () => {
        console.log(chalk.blue('└────────────────────────────────────────────────────────────'));
      });

      this.logMonitors.set(instanceId, tail);
    } catch (error) {
      console.warn(chalk.yellow(`Could not start monitoring log for ${instanceId}: ${error}`));
    }
  }
}
