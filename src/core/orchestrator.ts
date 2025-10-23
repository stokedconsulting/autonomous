/**
 * Orchestrator - Coordinates LLM instances and manages the autonomous workflow
 */

import { ConfigManager } from './config-manager.js';
import { AssignmentManager } from './assignment-manager.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { GitHubAPI } from '../github/api.js';
import { LLMAdapter } from '../llm/adapter.js';
import { ClaudeAdapter } from '../llm/claude-adapter.js';
import { PromptBuilder } from '../llm/prompt-builder.js';
import { LLMProvider, Assignment } from '../types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

export class Orchestrator {
  private configManager: ConfigManager;
  private assignmentManager: AssignmentManager;
  private worktreeManager: WorktreeManager;
  private githubAPI: GitHubAPI | null = null;
  private adapters = new Map<LLMProvider, LLMAdapter>();
  private autonomousDataDir: string;
  private isRunning = false;

  constructor(projectPath: string, configManager: ConfigManager, assignmentManager: AssignmentManager) {
    this.configManager = configManager;
    this.assignmentManager = assignmentManager;
    this.worktreeManager = new WorktreeManager(projectPath);
    this.autonomousDataDir = join(projectPath, '.autonomous');
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    // Create autonomous data directory
    await fs.mkdir(this.autonomousDataDir, { recursive: true });

    // Initialize GitHub API
    const config = this.configManager.getConfig();
    const githubToken = process.env.GITHUB_TOKEN || config.github.token;

    if (!githubToken) {
      throw new Error('GitHub token not found. Set GITHUB_TOKEN environment variable.');
    }

    this.githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);

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
        console.warn(chalk.yellow(`Warning: ${provider} CLI not found at ${llmConfig.cliPath || 'default path'}`));
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

    // Assign issues to LLM instances
    await this.assignIssues(issues);

    // Start monitoring loop
    this.startMonitoringLoop();
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    this.isRunning = false;

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
      labels: issue.labels.map((l: any) => l.name),
    });

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

    // Update assignment status
    await this.assignmentManager.updateAssignment(assignment.id, {
      status: 'in-progress',
    });

    // Add work session
    await this.assignmentManager.addWorkSession(assignment.id, {
      startedAt: new Date().toISOString(),
      promptUsed: prompt,
    });

    console.log(chalk.green(`✓ Assignment created and ${provider} instance started`));
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
}
