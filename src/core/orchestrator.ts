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
import { isProcessRunning } from '../utils/process.js';

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
        await this.assignmentManager.initialize(config.github.owner, this.projectPath);

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

    // First, check for dead processes and resurrect them
    await this.resurrectDeadAssignments();

    console.log(chalk.blue('Fetching available issues from GitHub...'));

    // Fetch issues
    let issues: Issue[] = [];
    try {
      issues = await this.fetchAvailableIssues();
    } catch (error) {
      console.error(
        chalk.yellow('⚠️  Error fetching issues from GitHub:'),
        error instanceof Error ? error.message : String(error)
      );
      console.log(chalk.yellow('Will retry in the monitoring loop...'));
      // Continue to monitoring loop even if initial fetch fails
      this.startMonitoringLoop();
      return;
    }

    if (issues.length === 0) {
      console.log(chalk.yellow('No issues available for assignment.'));
      console.log('Make sure issues have the correct labels configured in .autonomous-config.json');
      // Still start monitoring loop to pick up work later
      this.startMonitoringLoop();
      return;
    }

    console.log(chalk.green(`Found ${issues.length} available issue(s)`));

    // Evaluate and prioritize issues
    let evaluated: any[];
    let skipped: Issue[];
    try {
      const result = await this.issueEvaluator.evaluateIssues(issues, {
        verbose: this.verbose,
      });
      evaluated = result.evaluated;
      skipped = result.skipped;
    } catch (error) {
      console.error(
        chalk.yellow('⚠️  Error evaluating issues:'),
        error instanceof Error ? error.message : String(error)
      );
      console.log(chalk.yellow('Will retry in the monitoring loop...'));
      this.startMonitoringLoop();
      return;
    }

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
      try {
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
          // Still start monitoring loop
          this.startMonitoringLoop();
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
      } catch (error) {
        console.error(
          chalk.yellow('⚠️  Error fetching project metadata:'),
          error instanceof Error ? error.message : String(error)
        );
        console.log(chalk.yellow('Falling back to AI-only prioritization...'));
        // Fallback to AI-only prioritization on error
        issuesForAssignment = evaluated.map((evaluation) =>
          issues.find((i) => i.number === evaluation.issueNumber)
        ).filter((i): i is Issue => i !== undefined);
      }
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
    try {
      await this.assignIssues(issuesForAssignment);
    } catch (error) {
      console.error(
        chalk.yellow('⚠️  Error during initial assignment:'),
        error instanceof Error ? error.message : String(error)
      );
      console.log(chalk.yellow('Will retry in the monitoring loop...'));
    }

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
   * Filters out issues with non-ready statuses (Needs more info, Evaluated, etc)
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
    let availableIssues = issues.filter((issue) => !this.assignmentManager.isIssueAssigned(issue.number));

    // If project API is available, filter by status using BATCH query
    if (this.projectsAPI) {
      try {
        // Get ALL project items in ONE query with assignable statuses from config
        const config = this.configManager.getConfig();
        const readyStatuses = config.project?.fields.status.readyValues || [];

        const result = await this.projectsAPI.queryItems({
          status: readyStatuses,
          limit: 100,
        });

        // Create a Set of issue numbers that are ready
        const readyIssueNumbers = new Set(result.items.map(item => item.content.number));

        // Filter to only issues that are in the ready set
        return availableIssues.filter(issue => readyIssueNumbers.has(issue.number));
      } catch (error) {
        console.warn(`Could not filter by project status: ${error}`);
        // Fall back to returning all available issues
        return availableIssues;
      }
    }

    return availableIssues;
  }

  /**
   * Assign issues to LLM instances
   */
  private async assignIssues(issues: any[]): Promise<void> {
    const enabledLLMs = this.configManager.getEnabledLLMs();
    const config = this.configManager.getConfig();

    for (const provider of enabledLLMs) {
      const llmConfig = this.configManager.getLLMConfig(provider);
      const activeCount = await this.assignmentManager.getActiveAssignmentsCount(provider);
      const available = llmConfig.maxConcurrentIssues - activeCount;

      if (available <= 0) {
        console.log(chalk.gray(`${provider}: at capacity (${activeCount}/${llmConfig.maxConcurrentIssues})`));

        // Show which issues are consuming capacity
        const activeAssignments = this.assignmentManager.getAssignmentsByProvider(provider)
          .filter(a => a.status === 'assigned' || a.status === 'in-progress');

        if (activeAssignments.length > 0) {
          console.log(chalk.gray(`  Active assignments:`));
          for (const assignment of activeAssignments) {
            const timeAgo = this.getTimeAgo(assignment.assignedAt);
            console.log(chalk.gray(`    #${assignment.issueNumber} (${assignment.status}) - started ${timeAgo}`));
          }
        } else {
          console.log(chalk.yellow(`  ⚠️  No active assignments found but capacity shows full - possible sync issue`));
        }

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
    // Check if already assigned
    if (this.assignmentManager.isIssueAssigned(issue.number)) {
      console.log(chalk.yellow(`Issue #${issue.number} is already assigned, skipping...`));
      return;
    }

    console.log(chalk.blue(`\nAssigning issue #${issue.number} to ${provider}...`));

    const config = this.configManager.getConfig();

    // Generate branch name
    const branchName = `${config.worktree.branchPrefix || 'feature/issue-'}${issue.number}-${this.slugify(issue.title)}`;

    // Create worktree
    console.log('Creating worktree...');
    let worktreePath: string;
    try {
      worktreePath = await this.worktreeManager.createWorktree({
        issueNumber: issue.number,
        branchName,
        baseDir: config.worktree.baseDir,
        projectName,
        baseBranch: await this.worktreeManager.getDefaultBranch(),
      });
      console.log(chalk.green(`✓ Worktree created: ${worktreePath}`));
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Could not create worktree: ${error instanceof Error ? error.message : String(error)}`));
      console.log(chalk.yellow(`   Skipping issue #${issue.number}`));
      return;
    }

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
   * Checks for completion via hooks (primary) and dead processes (fallback)
   * Syncs from GitHub periodically to detect manual status changes
   */
  private async startMonitoringLoop(): Promise<void> {
    console.log(chalk.blue('\nStarting monitoring loop...\n'));
    console.log(chalk.gray('  Checking for completion every 60s'));
    console.log(chalk.gray('  Syncing from GitHub every 5m\n'));

    let cycleCount = 0;

    while (this.isRunning) {
      try {
        await this.checkAssignments();

        // Sync from GitHub every 5 minutes (5 cycles) to detect manual changes
        cycleCount++;
        if (cycleCount >= 5) {
          if (this.verbose) {
            console.log(chalk.gray('\n  🔄 Periodic sync from GitHub...'));
          }
          await this.assignmentManager.syncStatusFromGitHub();
          cycleCount = 0;
        }
      } catch (error) {
        console.error(
          chalk.yellow('⚠️  Error in monitoring loop (will retry):'),
          error instanceof Error ? error.message : String(error)
        );
        if (this.verbose) {
          console.error(chalk.gray('Stack trace:'), error);
        }
      }
      await this.sleep(60000); // Check every 60 seconds (hooks handle immediate completion)
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
      try {
        // Fetch new issues and assign
        const issues = await this.fetchAvailableIssues();
        if (issues.length > 0) {
          await this.assignIssues(issues);
        }
      } catch (error) {
        console.error(
          chalk.yellow('⚠️  Error fetching available issues (will retry next cycle):'),
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  /**
   * Check a single assignment for completion
   */
  private async checkAssignment(assignment: Assignment): Promise<void> {
    const adapter = this.adapters.get(assignment.llmProvider);
    if (!adapter) {
      return;
    }

    try {
      const status = await adapter.getStatus(assignment.llmInstanceId);

      // If session ended, mark as complete
      if (!status.isRunning && assignment.status === 'in-progress') {
        console.log(chalk.green(`\n✓ Issue #${assignment.issueNumber} work completed by ${assignment.llmProvider}`));

        // Check for session file with PR info
        const sessionFile = join(this.autonomousDataDir, `session-${assignment.llmInstanceId}.json`);
        let prNumber: number | undefined;
        let prUrl: string | undefined;
        let summary: string | undefined;

        try {
          const sessionData = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));
          prNumber = sessionData.prNumber;
          prUrl = sessionData.prUrl;
          summary = sessionData.summary || 'Work completed';
        } catch {
          // No session file or couldn't parse - that's ok
          summary = 'Work completed';
        }

        // Update assignment to llm-complete
        const updates: any = {
          completedAt: new Date().toISOString(),
        };

        if (prNumber) updates.prNumber = prNumber;
        if (prUrl) updates.prUrl = prUrl;

        // Update with GitHub sync if available
        if (this.projectsAPI) {
          await this.assignmentManager.updateStatusWithSync(assignment.id, 'llm-complete');
          await this.assignmentManager.updateAssignment(assignment.id, updates);

          // Add labels based on Work Type and changes
          await this.addCompletionLabels(assignment.issueNumber, assignment.projectItemId, prNumber);
        } else {
          await this.assignmentManager.updateAssignment(assignment.id, {
            ...updates,
            status: 'llm-complete',
          });
        }

        // Add final work session
        await this.assignmentManager.addWorkSession(assignment.id, {
          endedAt: new Date().toISOString(),
          summary,
        });

        if (prUrl) {
          console.log(chalk.blue(`   PR created: ${prUrl}`));
        }
      }
    } catch (error) {
      console.error(
        chalk.red(`Error checking assignment for issue #${assignment.issueNumber}:`),
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Resurrect dead assignments
   * Check all in-progress assignments and restart any with dead processes
   */
  private async resurrectDeadAssignments(): Promise<void> {
    const inProgressAssignments = this.assignmentManager.getAssignmentsByStatus('in-progress');

    if (inProgressAssignments.length === 0) {
      return;
    }

    console.log(chalk.blue('Checking for dead processes...'));

    let resurrected = 0;

    for (const assignment of inProgressAssignments) {
      const adapter = this.adapters.get(assignment.llmProvider);
      if (!adapter) {
        console.warn(chalk.yellow(`No adapter found for ${assignment.llmProvider}, skipping resurrection`));
        continue;
      }

      try {
        const status = await adapter.getStatus(assignment.llmInstanceId);

        // If status says not running (session ended via hook), it's legitimately done
        if (!status.isRunning) {
          if (this.verbose) {
            console.log(chalk.gray(`  Instance ${assignment.llmInstanceId}: Session completed normally`));
          }
          continue;
        }

        // Check if process is actually running
        if (status.processId && !isProcessRunning(status.processId)) {
          console.log(chalk.yellow(`\n⚠️  Dead process detected for issue #${assignment.issueNumber}`));
          console.log(chalk.gray(`   Instance: ${assignment.llmInstanceId}`));
          console.log(chalk.gray(`   Process ID: ${status.processId} (not running)`));
          console.log(chalk.blue(`   Resurrecting process...`));

          // Generate continuation prompt
          const prompt = PromptBuilder.buildContinuationPrompt({
            assignment,
            worktreePath: assignment.worktreePath,
            lastSummary: assignment.workSessions.length > 0
              ? assignment.workSessions[assignment.workSessions.length - 1].summary
              : undefined,
          });

          // Restart the LLM instance
          const newInstanceId = await adapter.start({
            assignment,
            prompt,
            workingDirectory: assignment.worktreePath,
          });

          // Update assignment with new instance ID
          assignment.llmInstanceId = newInstanceId;
          await this.assignmentManager.updateAssignment(assignment.id, {
            lastActivity: new Date().toISOString(),
          });

          // Add a new work session for the resurrection
          await this.assignmentManager.addWorkSession(assignment.id, {
            startedAt: new Date().toISOString(),
            promptUsed: prompt,
            summary: 'Process resurrected after unexpected termination',
          });

          console.log(chalk.green(`✓ Process resurrected with new instance: ${newInstanceId}`));
          resurrected++;

          // Start log monitoring in verbose mode
          if (this.verbose) {
            await this.startLogMonitoring(newInstanceId, assignment.issueNumber);
          }
        } else if (!status.processId) {
          console.log(chalk.yellow(`\n⚠️  No process ID for issue #${assignment.issueNumber}`));
          console.log(chalk.gray(`   Instance: ${assignment.llmInstanceId}`));
          console.log(chalk.blue(`   Starting process...`));

          // This assignment never had a process started (pre-fix zombie)
          const prompt = PromptBuilder.buildContinuationPrompt({
            assignment,
            worktreePath: assignment.worktreePath,
            lastSummary: assignment.workSessions.length > 0
              ? assignment.workSessions[assignment.workSessions.length - 1].summary
              : undefined,
          });

          const newInstanceId = await adapter.start({
            assignment,
            prompt,
            workingDirectory: assignment.worktreePath,
          });

          assignment.llmInstanceId = newInstanceId;
          await this.assignmentManager.updateAssignment(assignment.id, {
            lastActivity: new Date().toISOString(),
          });

          await this.assignmentManager.addWorkSession(assignment.id, {
            startedAt: new Date().toISOString(),
            promptUsed: prompt,
            summary: 'Process started for previously unstarted assignment',
          });

          console.log(chalk.green(`✓ Process started with instance: ${newInstanceId}`));
          resurrected++;

          if (this.verbose) {
            await this.startLogMonitoring(newInstanceId, assignment.issueNumber);
          }
        }
      } catch (error) {
        console.error(
          chalk.red(`Failed to resurrect assignment for issue #${assignment.issueNumber}:`),
          error instanceof Error ? error.message : String(error)
        );
        // Continue with other assignments
      }
    }

    if (resurrected > 0) {
      console.log(chalk.green(`\n✓ Resurrected ${resurrected} process(es)\n`));
    } else {
      console.log(chalk.green('✓ All processes are running\n'));
    }
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
   * Get human-readable time ago string
   */
  private getTimeAgo(timestamp: string): string {
    const now = new Date();
    const past = new Date(timestamp);
    const diffMs = now.getTime() - past.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  /**
   * Add labels to issue based on Work Type and changes made
   */
  private async addCompletionLabels(
    issueNumber: number,
    projectItemId: string | undefined,
    prNumber: number | undefined
  ): Promise<void> {
    if (!this.projectsAPI || !this.githubAPI || !projectItemId) {
      return;
    }

    try {
      const labelsToAdd: string[] = [];

      // Get Work Type from project
      const workType = await this.projectsAPI.getItemSelectFieldValue(projectItemId, 'Work Type');

      // Map Work Type to label
      if (workType) {
        if (workType.includes('Bug')) {
          labelsToAdd.push('bug');
        } else if (workType.includes('Feature') || workType.includes('Enhancement')) {
          labelsToAdd.push('enhancement');
        }
      }

      // Check if documentation was modified (if PR exists)
      if (prNumber) {
        try {
          const files = await this.githubAPI.getPullRequestFiles(prNumber);

          // Check if any .md files or docs folders were modified
          const hasDocChanges = files.some(file =>
            file.filename.endsWith('.md') ||
            file.filename.includes('/docs/') ||
            file.filename.includes('README')
          );

          if (hasDocChanges) {
            labelsToAdd.push('documentation');
          }
        } catch (error) {
          // PR not yet created or error fetching - skip
        }
      }

      // Add labels if we have any
      if (labelsToAdd.length > 0) {
        await this.githubAPI.addLabels(issueNumber, labelsToAdd);
        console.log(chalk.gray(`   ✓ Added labels: ${labelsToAdd.join(', ')}`));
      }
    } catch (error) {
      // Non-critical - log but don't fail
      if (this.verbose) {
        console.log(chalk.gray(`   ⚠️  Could not add labels: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
  }

  /**
   * Start monitoring a log file and stream output
   */
  private async startLogMonitoring(instanceId: string, issueNumber: number): Promise<void> {
    const logFile = join(this.autonomousDataDir, `output-${instanceId}.log`);
    const activityFile = join(this.autonomousDataDir, `activity-${instanceId}.log`);

    console.log(chalk.blue(`\n${'='.repeat(80)}`));
    console.log(chalk.blue.bold(`  📺 LIVE OUTPUT - Issue #${issueNumber}`));
    console.log(chalk.blue(`  Instance: ${instanceId}`));
    console.log(chalk.blue(`  Log: ${logFile}`));
    console.log(chalk.blue(`${'='.repeat(80)}\n`));

    // Wait for log file to be created
    let retries = 0;
    while (retries < 10) {
      try {
        await fs.access(logFile);
        break;
      } catch {
        await this.sleep(500);
        retries++;
      }
    }

    try {
      // Read existing content first
      const existingContent = await fs.readFile(logFile, 'utf-8');
      if (existingContent) {
        console.log(chalk.gray(existingContent));
      }

      // Import spawn dynamically
      const { spawn } = await import('child_process');

      // Start tailing the log file with inherited stdio
      const tail = spawn('tail', ['-f', '-n', '0', logFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      tail.stdout.on('data', (data) => {
        // Output directly without prefix for clean display
        process.stdout.write(data.toString());
      });

      tail.stderr.on('data', (data) => {
        process.stderr.write(chalk.red('ERROR: ') + data.toString());
      });

      tail.on('close', (code) => {
        console.log(chalk.blue(`\n${'='.repeat(80)}`));
        console.log(chalk.blue(`  Session ended (exit code: ${code})`));
        console.log(chalk.blue(`${'='.repeat(80)}\n`));
      });

      this.logMonitors.set(instanceId, tail);

      // Also monitor activity log for tool usage
      this.startActivityMonitoring(instanceId, activityFile);
    } catch (error) {
      console.warn(chalk.yellow(`Could not start monitoring log for ${instanceId}: ${error}`));
    }
  }

  /**
   * Monitor activity log to show tool usage
   */
  private async startActivityMonitoring(instanceId: string, activityFile: string): Promise<void> {
    let lastSize = 0;

    const checkActivity = async () => {
      try {
        const stats = await fs.stat(activityFile);
        if (stats.size > lastSize) {
          const content = await fs.readFile(activityFile, 'utf-8');
          const lines = content.split('\n');
          const newLines = lines.slice(Math.max(0, lines.length - 5));

          // Show last tool used
          for (const line of newLines) {
            if (line.trim()) {
              const match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+-\s+Tool:\s+(.+)/);
              if (match) {
                const [, timestamp, tool] = match;
                console.log(chalk.gray(`\n[${new Date(timestamp).toLocaleTimeString()}] 🔧 Tool used: ${tool}`));
              }
            }
          }
          lastSize = stats.size;
        }
      } catch {
        // File doesn't exist yet
      }
    };

    // Check every 2 seconds for activity
    const interval = setInterval(checkActivity, 2000);

    // Store interval for cleanup
    if (!this.logMonitors.has(`${instanceId}-activity`)) {
      this.logMonitors.set(`${instanceId}-activity`, { kill: () => clearInterval(interval) } as any);
    }
  }
}
