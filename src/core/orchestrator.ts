/**
 * Orchestrator - Coordinates LLM instances and manages the autonomous workflow
 */

import { ConfigManager } from './config-manager.js';
import { AssignmentManager } from './assignment-manager.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { IssueEvaluator } from './issue-evaluator.js';
import { GitHubAPI } from '../github/api.js';
import { GitHubProjectsAPI, ProjectItem } from '../github/projects-api.js';
import { ProjectFieldMapper } from '../github/project-field-mapper.js';
// import { ProjectAwarePrioritizer } from './project-aware-prioritizer.js'; // Unused for now
import { LLMAdapter } from '../llm/adapter.js';
import { ClaudeAdapter } from '../llm/claude-adapter.js';
import { PromptBuilder } from '../llm/prompt-builder.js';
import { LLMProvider, Assignment, Issue, LLMConfig, IssueEvaluation } from '../types/index.js';
import { getGitHubToken } from '../utils/github-token.js';
import { resolveProjectId } from '../github/project-resolver.js';
import { MergeWorker } from './merge-worker.js';
import { ReviewWorker } from './review-worker.js';
import { EpicOrchestrator } from './epic-orchestrator.js';
// import { PhaseConsolidationWorker } from './phase-consolidation-worker.js'; // Temporarily disabled - has compilation errors
import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';
import chalk from 'chalk';
import { isProcessRunning, isZombieProcess } from '../utils/process.js';
import { detectSessionCompletion, extractPRNumber, detectAutonomousSignals } from '../utils/session-analyzer.js';

export class Orchestrator {
  private configManager: ConfigManager;
  private assignmentManager: AssignmentManager;
  private worktreeManager: WorktreeManager;
  private issueEvaluator: IssueEvaluator;
  private githubAPI: GitHubAPI | null = null;
  private projectsAPI: GitHubProjectsAPI | null = null;
  private fieldMapper: ProjectFieldMapper | null = null;
  // private prioritizer: ProjectAwarePrioritizer | null = null; // Unused for now
  private adapters = new Map<LLMProvider, LLMAdapter>();
  private mergeWorker: MergeWorker | null = null;
  private reviewWorker: ReviewWorker | null = null;
  // private phaseConsolidationWorker: PhaseConsolidationWorker | null = null; // Temporarily disabled
  private autonomousDataDir: string;
  private projectPath: string;
  private isRunning = false;
  private verbose: boolean;

  // Epic orchestration
  private epicOrchestrator: EpicOrchestrator | null = null;
  private epicConfig: { epicName: string; autoMergeToMain: boolean } | null = null;

  constructor(
    projectPath: string,
    configManager: ConfigManager,
    assignmentManager: AssignmentManager,
    verbose: boolean = false,
    epicOptions?: { epicName?: string; autoMergeToMain?: boolean }
  ) {
    this.projectPath = projectPath;
    this.configManager = configManager;
    this.assignmentManager = assignmentManager;
    this.worktreeManager = new WorktreeManager(projectPath);
    this.autonomousDataDir = join(projectPath, '.autonomous');
    this.verbose = verbose;

    // Store epic configuration if provided
    if (epicOptions?.epicName) {
      this.epicConfig = {
        epicName: epicOptions.epicName,
        autoMergeToMain: epicOptions.autoMergeToMain ?? false,
      };
    }

    // Issue evaluator will be initialized in initialize() after githubAPI is ready
    const config = configManager.getConfig();
    const claudePath = config.llms?.claude?.cliPath || 'claude';
    this.issueEvaluator = new IssueEvaluator(claudePath); // Temporary, will be re-initialized
  }

  /**
   * Log workflow event (visible even without --verbose)
   */
  private logEvent(emoji: string, message: string, details?: string): void {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${chalk.gray(`[${timestamp}]`)} ${emoji}  ${chalk.bold(message)}`);
    if (details) {
      console.log(chalk.gray(`  ${details}`));
    }
  }

  /**
   * Handle config changes
   */
  private async handleConfigChange(): Promise<void> {
    console.log(chalk.blue('\n⚙️  Config changed, re-initializing...'));
    // For now, just re-initialize everything. In the future, be more granular.
    await this.initialize();
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
    this.issueEvaluator = new IssueEvaluator(claudePath, this.githubAPI);

    // Initialize GitHub Projects v2 integration if enabled
    if (config.project?.enabled) {
      const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
      if (projectId) {
        this.projectsAPI = new GitHubProjectsAPI(projectId, config.project);
        this.fieldMapper = new ProjectFieldMapper(this.projectsAPI, config.project);
        // this.prioritizer = new ProjectAwarePrioritizer(config.project, this.fieldMapper); // Unused for now

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

    // Initialize merge worker if enabled
    if (config.mergeWorker?.enabled) {
      this.mergeWorker = new MergeWorker(
        this.projectPath,
        this.assignmentManager,
        this.githubAPI,
        this.projectsAPI,
        {
          enabled: true,
          claudePath: config.mergeWorker.claudePath || config.llms?.claude?.cliPath || 'claude',
          mainBranch: config.mergeWorker.mainBranch || 'main',
          stageBranch: config.mergeWorker.stageBranch || 'stage',
          requireAllPersonasPass: config.mergeWorker.requireAllPersonasPass ?? true,
          autoResolveConflicts: config.mergeWorker.autoResolveConflicts ?? true,
          evaluateValue: config.project?.fields.status.evaluateValue, // Pass evaluateValue for rejection workflow
          autoMergeToMain: this.epicConfig?.autoMergeToMain ?? false, // Epic mode: auto-merge to main
        },
        this.verbose
      );
      console.log(chalk.green('✓ Merge Worker initialized' + (this.epicOrchestrator ? ' (Epic Mode)' : '')));
    }

    // Initialize review worker for pre-resurrection reviews
    if (this.githubAPI) {
      this.reviewWorker = new ReviewWorker(
        this.projectPath,
        this.assignmentManager,
        this.githubAPI,
        config.llms?.claude?.cliPath || 'claude',
        1, // maxConcurrent - only need 1 for resurrection reviews
        this.fieldMapper
      );
      if (this.verbose) {
        console.log(chalk.green('✓ Review Worker initialized for pre-resurrection checks'));
      }
    }

    // Initialize epic orchestrator if epic mode is enabled
    if (this.epicConfig && this.githubAPI && this.projectsAPI) {
      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: githubToken });

      this.epicOrchestrator = new EpicOrchestrator(
        octokit,
        config.github.owner,
        config.github.repo,
        {
          epicName: this.epicConfig.epicName,
          currentPhase: null,
          autoMergeToMain: this.epicConfig.autoMergeToMain,
        },
        this.projectsAPI || undefined,
        this.fieldMapper || undefined
      );

      console.log(chalk.green(`✓ Epic Mode enabled: "${this.epicConfig.epicName}"`));
      if (this.epicConfig.autoMergeToMain) {
        console.log(chalk.green('  Auto-merge to main: ENABLED'));
      } else {
        console.log(chalk.gray('  Auto-merge to main: DISABLED (manual merge required)'));
      }

      // Initialize phase consolidation worker for epic mode
      // Temporarily disabled due to compilation errors
      // this.phaseConsolidationWorker = new PhaseConsolidationWorker(
      //   this.assignmentManager,
      //   this.worktreeManager,
      //   this.epicOrchestrator,
      //   this.projectPath,
      //   {
      //     enabled: true,
      //     autoMergeToMain: this.epicConfig.autoMergeToMain,
      //     claudePath: config.llms?.claude?.cliPath || 'claude',
      //     mainBranch: config.mergeWorker?.mainBranch || 'main',
      //     stageBranch: config.mergeWorker?.stageBranch || 'stage',
      //     testCommand: config.requirements.testingRequired ? 'npm test' : undefined,
      //   },
      //   this.verbose
      // );
      // console.log(chalk.green('✓ Phase Consolidation Worker initialized'));
    }
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    this.isRunning = true;

    // Start watching config file for changes
    this.configManager.startWatching(async () => {
      await this.handleConfigChange();
    });

    // First, check for dead processes and resurrect them
    await this.resurrectDeadAssignments();

    // Comprehensive sync from GitHub to establish correct state
    if (this.projectsAPI && this.fieldMapper) {
      console.log(chalk.blue('Syncing all fields from GitHub Project...'));
      try {
        const config = this.configManager.getConfig();
        const syncResult = await this.assignmentManager.syncAllFieldsFromGitHub({
          assignedInstanceFieldName: config.project?.fields.assignedInstance?.fieldName || 'Assigned Instance',
          readyStatuses: config.project?.fields.status.readyValues || ['Ready'],
          completeStatuses: ['dev-complete', 'stage-ready', 'merged'],
        });

        if (syncResult.conflicts > 0 || syncResult.removed > 0 || syncResult.clearedStale > 0) {
          console.log(chalk.yellow(`  ⚠️  Resolved ${syncResult.conflicts} conflicts, removed ${syncResult.removed} orphaned, cleared ${syncResult.clearedStale} stale`));
        } else {
          console.log(chalk.green(`  ✓ All assignments in sync (${syncResult.synced} checked)`));
        }
      } catch (error) {
        console.warn(chalk.yellow('⚠️  Could not sync from GitHub:'), error instanceof Error ? error.message : String(error));
      }
    }

    // Epic Mode: Clean up non-epic assignments
    if (this.epicOrchestrator && this.projectsAPI && this.fieldMapper) {
      await this.cleanupNonEpicAssignments();
    }

    // Perform initial evaluation and assignment
    console.log(chalk.blue('Fetching available issues from GitHub...'));

    try {
      await this.performPeriodicEvaluationAndAssignment();
    } catch (error) {
      console.error(
        chalk.yellow('⚠️  Error during initial evaluation:'),
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
    console.log(chalk.blue('\n🛑 Stopping orchestrator...\n'));
    
    // Check for dev-complete items that need merging
    const devCompleteItems = this.assignmentManager.getAssignmentsByStatus('dev-complete');
    
    if (devCompleteItems.length > 0 && this.mergeWorker) {
      console.log(chalk.yellow(`⚠️  Found ${devCompleteItems.length} dev-complete item(s) awaiting merge`));
      console.log(chalk.blue('📋 Processing final merges before shutdown...\n'));
      
      try {
        await this.mergeWorker.processDevCompleteItems(!!this.epicOrchestrator);
        console.log(chalk.green('✓ All pending merges completed\n'));
      } catch (error) {
        console.error(chalk.red('⚠️  Error processing final merges:'), error instanceof Error ? error.message : String(error));
        console.log(chalk.yellow('Some items may still be in dev-complete status\n'));
      }
    }
    
    this.isRunning = false;

    // Stop watching config file
    this.configManager.stopWatching();

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
    
    console.log(chalk.green('✓ Orchestrator stopped\n'));
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
   * Filters out issues with non-ready statuses (Needs More Info, Evaluated, etc)
   */
  private async fetchAvailableIssues(): Promise<Issue[]> {
    if (!this.githubAPI) {
      throw new Error('GitHub API not initialized');
    }

    const config = this.configManager.getConfig();

    // If project API is available, fetch issues by their project item numbers
    // This avoids pagination issues where old issues might not be in the first page
    if (this.projectsAPI) {
      try {
        // Get ALL project items in ONE query with assignable statuses from config
        const config = this.configManager.getConfig();
        const readyStatuses = config.project?.fields.status.readyValues || [];

        if (this.verbose) {
          console.log(chalk.gray(`  Filtering by project statuses: ${readyStatuses.join(', ')}`));
        }

        // Use getAllItems() to paginate through ALL ready items, not just first 100
        const allReadyItems = await this.projectsAPI.getAllItems({
          status: readyStatuses,
          includeNoStatus: true, // Include items with no status set (ready to start)
        });

        if (this.verbose) {
          console.log(chalk.gray(`  Found ${allReadyItems.length} items in project with ready statuses (paginated)`));
        }

        // Filter by epic if epic mode is enabled
        let epicFilteredItems = allReadyItems;
        if (this.epicOrchestrator && this.fieldMapper) {
          // Map result items to ProjectItemWithMetadata
          const itemsWithMetadata = allReadyItems.map(item => this.fieldMapper!.mapItemWithMetadata(item));

          // Filter to only items in the epic
          const epicItems = this.epicOrchestrator.filterEpicItems(itemsWithMetadata);

          console.log(chalk.blue(`\n📊 Epic Mode: "${this.epicConfig!.epicName}"`));
          console.log(chalk.gray(`  Total ready items: ${allReadyItems.length}`));
          console.log(chalk.gray(`  Epic items: ${epicItems.length}`));

          // Apply phase-based filtering (sequential phase execution)
          const phaseAssignableItems = await this.epicOrchestrator.getAssignableItemsForEpic(
            epicItems,
            this.assignmentManager
          );

          console.log(chalk.gray(`  Phase-assignable items: ${phaseAssignableItems.length}`));

          if (phaseAssignableItems.length === 0) {
            console.log(chalk.yellow(`  ⚠️  No assignable items in current phase of epic "${this.epicConfig!.epicName}"`));
            return [];
          }

          // Query the project for the full item data (including field values) for phase assignable items
          // This is needed because phaseAssignableItems may include items not in the original ready statuses query
          // Use pagination to fetch all items (100 max per request)
          const phaseIssueNumbers = new Set(phaseAssignableItems.map(item => item.issueNumber));
          const allProjectItems: ProjectItem[] = [];
          let hasNextPage = true;
          let cursor: string | undefined = undefined;

          while (hasNextPage) {
            const pageResult = await this.projectsAPI!.queryItems({
              limit: 100,
              cursor: cursor,
            });

            allProjectItems.push(...pageResult.items);
            hasNextPage = pageResult.hasNextPage;
            cursor = pageResult.endCursor;

            // Early exit if we found all needed items
            const foundItems = allProjectItems.filter(item => phaseIssueNumbers.has(item.content.number));
            if (foundItems.length === phaseIssueNumbers.size) {
              break;
            }
          }

          epicFilteredItems = allProjectItems.filter(item =>
            phaseIssueNumbers.has(item.content.number)
          );
        } else if (this.fieldMapper) {
          // Non-epic mode: Filter out phase master items
          // Phase masters have MASTER in title + (Phase N) where N is integer
          const itemsWithMetadata = allReadyItems.map(item => this.fieldMapper!.mapItemWithMetadata(item));
          const workItems = itemsWithMetadata.filter(item => {
            const title = item.issueTitle;
            const hasMaster = /MASTER/i.test(title);
            const hasIntegerPhase = /\(Phase\s+\d+\)/i.test(title) && !/\(Phase\s+\d+\.\d+\)/i.test(title);
            return !(hasMaster && hasIntegerPhase); // Filter OUT phase masters
          });
          const workItemNumbers = new Set(workItems.map(item => item.issueNumber));
          epicFilteredItems = allReadyItems.filter(item => workItemNumbers.has(item.content.number));

          if (this.verbose && workItems.length < allReadyItems.length) {
            const filteredCount = allReadyItems.length - workItems.length;
            console.log(chalk.gray(`  Filtered out ${filteredCount} phase master item(s)`));
          }
        }

        // Check each item's "Assigned Instance" field and clear dead PIDs
        const availableIssueNumbers = new Set<number>();
        let clearedDeadAssignments = 0;

        if (this.verbose) {
          console.log(chalk.gray(`\n  Checking ${epicFilteredItems.length} items for availability...`));
        }

        for (const item of epicFilteredItems) {
          const issueNumber = item.content.number;
          const status = item.fieldValues[config.project?.fields.status.fieldName || 'Status'];

          if (this.verbose) {
            console.log(chalk.cyan(`\n  Issue #${issueNumber}: ${item.content.title}`));
            console.log(chalk.gray(`    Status: ${status || 'NOT SET'}`));
          }

          // Check if item has "Assigned Instance" field set
          const assignedInstanceField = config.project?.fields.assignedInstance;
          if (assignedInstanceField) {
            try {
              // Get assigned instance from cached field values (already fetched in queryItems)
              const assignedInstance = item.fieldValues[assignedInstanceField.fieldName];

              //console.log(chalk.gray(`    Assigned Instance: ${assignedInstance ? `"${assignedInstance}"` : '<EMPTY>'}`));
              //console.log(chalk.gray(`    Type: ${typeof assignedInstance}, Truthy: ${!!assignedInstance}`));

              if (assignedInstance) {
                // Instance is assigned - check if PID is still running
                const assignment = this.assignmentManager.getAssignmentByLLMInstanceId(assignedInstance);

                //console.log(chalk.gray(`    Assignment found in local state: ${assignment ? 'YES' : 'NO'}`));
                if (assignment) {
                  //console.log(chalk.gray(`    PID: ${assignment.processId || 'NOT SET'}`));
                }

                if (assignment && assignment.processId) {
                  const processRunning = isProcessRunning(assignment.processId);

                  if (!processRunning) {
                    // Process is dead - clear the assignment
                    if (this.verbose) {
                      console.log(chalk.yellow(`    ⚠️  DEAD PROCESS - clearing assignment`));
                    }
                    // Clear from GitHub Project
                    await this.projectsAPI.updateItemTextField(item.id, assignedInstanceField.fieldName, null);
                    // Clear from local cache
                    await this.assignmentManager.deleteAssignment(assignment.id);
                    availableIssueNumbers.add(issueNumber);
                    clearedDeadAssignments++;
                  } else {
                    // Process is still running - skip this issue
                    if (this.verbose) {
                      console.log(chalk.red(`    ✗ SKIPPING - process is still running`));
                    }
                  }
                } else {
                  // Instance ID doesn't match any known assignment - clear it
                  if (this.verbose) {
                    console.log(chalk.yellow(`    ⚠️  Unknown instance or no PID - clearing assignment`));
                  }
                  // Clear from GitHub Project
                  await this.projectsAPI.updateItemTextField(item.id, assignedInstanceField.fieldName, null);
                  // Clear from local cache if assignment exists
                  if (assignment) {
                    await this.assignmentManager.deleteAssignment(assignment.id);
                  }
                  availableIssueNumbers.add(issueNumber);
                  clearedDeadAssignments++;
                  if (this.verbose) {
                    console.log(chalk.green(`    ✓ CLEARED and marked AVAILABLE`));
                  }
                }
              } else {
                // No instance assigned - available
                if (this.verbose) {
                  console.log(chalk.green(`    ✓ No assignment - AVAILABLE`));
                }
                availableIssueNumbers.add(issueNumber);
              }
            } catch (error) {
              // Error reading field - assume available
              if (this.verbose) {
                console.log(chalk.yellow(`    ⚠️  Error reading field: ${error instanceof Error ? error.message : String(error)}`));
                console.log(chalk.green(`    ✓ Assuming AVAILABLE (error fallback)`));
              }
              availableIssueNumbers.add(issueNumber);
            }
          } else {
            // No assignedInstance field configured - use all items
            if (this.verbose) {
              console.log(chalk.magenta(`    ℹ️  No "Assigned Instance" field configured - marking AVAILABLE`));
            }
            availableIssueNumbers.add(issueNumber);
          }
        }

        if (this.verbose) {
          console.log(chalk.gray(`\n📊 Summary:`));
          console.log(chalk.gray(`  Total items checked: ${epicFilteredItems.length}`));
          console.log(chalk.gray(`  Available for assignment: ${availableIssueNumbers.size}`));
          console.log(chalk.gray(`  Cleared dead assignments: ${clearedDeadAssignments}`));
        }

        if (clearedDeadAssignments > 0) {
          console.log(chalk.green(`✓ Cleared ${clearedDeadAssignments} dead assignment(s)`));
        }

        // Fetch issues by their specific numbers from the project
        // This avoids pagination issues where old issues might not be in the first page
        console.log(chalk.gray(`\n📋 Fetching ${availableIssueNumbers.size} issues by number from GitHub...`));

        const availableIssues: Issue[] = [];
        let fetchErrors = 0;

        for (const issueNumber of availableIssueNumbers) {
          try {
            const issue = await this.githubAPI.getIssue(issueNumber);
            availableIssues.push(issue);
          } catch (error) {
            fetchErrors++;
            if (this.verbose) {
              console.log(chalk.yellow(`  ⚠️ Could not fetch issue #${issueNumber}: ${error instanceof Error ? error.message : String(error)}`));
            }
          }
        }

        //console.log(chalk.gray(`  Successfully fetched: ${availableIssues.length} issues`));
        if (fetchErrors > 0) {
          console.log(chalk.yellow(`  Failed to fetch: ${fetchErrors} issues (may be from different repo or deleted)`));
        }

        // Check for BLOCK_ALL items
        return await this.handleBlockAllItems(availableIssues);
      } catch (error) {
        console.warn(chalk.yellow(`  ⚠️  Could not filter by project: ${error}`));
        // Fall through to normal issue fetching
      }
    }

    // No project integration or project fetch failed - fetch all open issues with optional label filter
    const fetchOptions: { state: 'open' | 'closed' | 'all'; labels?: string[] } = {
      state: 'open',
    };

    if (config.github.labels && config.github.labels.length > 0) {
      fetchOptions.labels = config.github.labels;
    }

    const issues = await this.githubAPI.getIssues(fetchOptions);

    if (this.verbose) {
      console.log(chalk.gray(`  Fetched ${issues.length} open issues from GitHub`));
      if (config.github.labels && config.github.labels.length > 0) {
        console.log(chalk.gray(`  Filtered by labels: ${config.github.labels.join(', ')}`));
      } else {
        console.log(chalk.gray(`  No label filter (fetching all open issues)`));
      }
    }

    // Check for BLOCK_ALL items
    return await this.handleBlockAllItems(issues);
  }

  /**
   * Clean up non-epic assignments when entering epic mode
   * Unassigns any items not in the epic that don't have running processes
   */
  private async cleanupNonEpicAssignments(): Promise<void> {
    if (!this.epicOrchestrator || !this.projectsAPI || !this.fieldMapper) {
      return;
    }

    const config = this.configManager.getConfig();
    console.log(chalk.blue(`\n🧹 Epic Mode: Cleaning up non-epic assignments...`));

    // Get all items that might be assigned (In Progress, In Review, Evaluated)
    const assignedStatuses = ['In Progress', 'In Review', config.project?.fields.status.evaluateValue || 'Evaluate'];

    const allItems = await this.projectsAPI.getAllItems({
      status: assignedStatuses,
    });

    if (allItems.length === 0) {
      console.log(chalk.gray('  No assigned items found'));
      return;
    }

    console.log(chalk.gray(`  Found ${allItems.length} potentially assigned items`));

    // Map to metadata and filter to non-epic items
    const itemsWithMetadata = allItems.map(item => this.fieldMapper!.mapItemWithMetadata(item));
    const epicItems = this.epicOrchestrator.filterEpicItems(itemsWithMetadata);
    const epicIssueNumbers = new Set(epicItems.map(item => item.issueNumber));

    // Find non-epic items
    const nonEpicItems = itemsWithMetadata.filter(item => !epicIssueNumbers.has(item.issueNumber));

    if (nonEpicItems.length === 0) {
      console.log(chalk.green(`  ✓ All assigned items are in epic "${this.epicConfig!.epicName}"`));
      return;
    }

    console.log(chalk.yellow(`  Found ${nonEpicItems.length} non-epic assigned items`));

    // Check each non-epic item and unassign if process not running
    let unassignedCount = 0;
    const readyStatus = config.project?.fields.status.readyValues?.[0] || 'Ready';
    const assignedInstanceField = config.project?.fields.assignedInstance;

    for (const item of nonEpicItems) {
      const assignment = this.assignmentManager.getAssignmentByIssue(item.issueNumber);

      // Check if process is running
      const hasRunningProcess = assignment && assignment.processId && isProcessRunning(assignment.processId);

      if (!hasRunningProcess) {
        console.log(chalk.gray(`  Unassigning #${item.issueNumber}: ${item.issueTitle}`));

        // Clear the Assigned Instance field
        if (assignedInstanceField) {
          try {
            await this.projectsAPI.updateItemTextField(item.projectItemId, assignedInstanceField.fieldName, null);
          } catch (error) {
            console.warn(chalk.yellow(`    Warning: Could not clear assignment field: ${error}`));
          }
        }

        // Set status back to Ready
        try {
          await this.projectsAPI.updateItemStatusByValue(item.projectItemId, readyStatus);
        } catch (error) {
          console.warn(chalk.yellow(`    Warning: Could not update status: ${error}`));
        }

        // Clean up local assignment if it exists
        if (assignment) {
          this.assignmentManager.deleteAssignment(assignment.id);
        }

        unassignedCount++;
      } else {
        console.log(chalk.gray(`  Keeping #${item.issueNumber}: process still running`));
      }
    }

    if (unassignedCount > 0) {
      console.log(chalk.green(`✓ Unassigned ${unassignedCount} non-epic item(s)`));
    } else {
      console.log(chalk.gray('  No items needed unassignment'));
    }
  }

  /**
   * Handle BLOCK_ALL labeled items
   * If a BLOCK_ALL item exists and is not in "In Review" or "Done":
   * - If unassigned: return only that item for assignment
   * - If assigned: return empty array (block all other assignments)
   * Otherwise: return all issues unchanged
   */
  private async handleBlockAllItems(issues: Issue[]): Promise<Issue[]> {
    // Find any items with the BLOCK_ALL label
    const blockAllItems = issues.filter(issue =>
      issue.labels.some(label => label.name === 'BLOCK_ALL')
    );

    if (blockAllItems.length === 0) {
      // No BLOCK_ALL items - proceed normally
      return issues;
    }

    console.log(chalk.yellow(`\n🚫 Found ${blockAllItems.length} BLOCK_ALL item(s)`));

    // Check if any BLOCK_ALL items are in blocking status
    const config = this.configManager.getConfig();
    const nonBlockingStatuses = [
      config.project?.fields.status.reviewValue || 'In Review',
      config.project?.fields.status.doneValue || 'Done',
    ];

    for (const blockItem of blockAllItems) {
      // Check if this item is in a blocking status (i.e., not in review or done)
      let itemStatus: string | null = null;

      if (this.projectsAPI && this.fieldMapper) {
        try {
          const metadata = await this.fieldMapper.getMetadataForIssues([blockItem.number]);
          const meta = metadata.get(blockItem.number);
          if (meta) {
            itemStatus = meta.status;
          }
        } catch (error) {
          // If we can't get status, assume it's blocking
          if (this.verbose) {
            console.log(chalk.gray(`  Could not get status for #${blockItem.number}, assuming blocking`));
          }
        }
      }

      // If status is null or not in non-blocking statuses, this item is blocking
      const isBlocking = !itemStatus || !nonBlockingStatuses.includes(itemStatus);

      if (isBlocking) {
        console.log(chalk.yellow(`  #${blockItem.number}: ${blockItem.title}`));
        console.log(chalk.gray(`    Status: ${itemStatus || 'Unknown'} (blocking)`));

        // Check if already assigned AND process is actually running
        const isAssigned = this.assignmentManager.isIssueAssigned(blockItem.number);
        let processActuallyRunning = false;

        if (isAssigned) {
          // Get the assignment and check if process is running
          const assignment = this.assignmentManager.getAllAssignments().find(a => a.issueNumber === blockItem.number);
          if (assignment?.processId) {
            processActuallyRunning = isProcessRunning(assignment.processId);
          }
        }

        if (isAssigned && processActuallyRunning) {
          console.log(chalk.red(`    Already assigned with running process - BLOCKING ALL OTHER ASSIGNMENTS`));
          console.log(chalk.gray(`    No other items will be assigned until this completes\n`));
          return []; // Block all assignments
        } else if (isAssigned && !processActuallyRunning) {
          console.log(chalk.yellow(`    Previously assigned but process is dead - RE-ASSIGNING`));
          console.log(chalk.gray(`    Clearing old assignment and reassigning...`));

          // Clear the old assignment so it can be reassigned
          const assignment = this.assignmentManager.getAllAssignments().find(a => a.issueNumber === blockItem.number);
          if (assignment) {
            await this.assignmentManager.deleteAssignment(assignment.id);
          }

          console.log(chalk.gray(`    All other items will wait until this completes\n`));
          return [blockItem]; // Reassign this item
        } else {
          console.log(chalk.blue(`    Not assigned - ASSIGNING THIS ITEM FIRST`));
          console.log(chalk.gray(`    All other items will wait until this completes\n`));
          return [blockItem]; // Only assign this item
        }
      } else {
        console.log(chalk.green(`  #${blockItem.number}: ${blockItem.title}`));
        console.log(chalk.gray(`    Status: ${itemStatus} (not blocking)`));
      }
    }

    // All BLOCK_ALL items are in non-blocking status - proceed normally
    console.log(chalk.green(`  All BLOCK_ALL items are in non-blocking status\n`));
    return issues;
  }

  /**
   * Assign issues to LLM instances
   */
  private async assignIssues(issues: Issue[]): Promise<void> {
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
  private async createAssignment(provider: LLMProvider, issue: Issue, projectName: string): Promise<void> {
    // Check if already assigned AND has running process
    const existingAssignment = this.assignmentManager.getAssignmentByIssue(issue.number);

    if (existingAssignment) {
      // Check if process is actually running
      let processRunning = false;
      if (existingAssignment.processId) {
        processRunning = isProcessRunning(existingAssignment.processId);
      }

      if (processRunning) {
        console.log(chalk.yellow(`Issue #${issue.number} is already assigned with running process, skipping...`));
        return;
      } else {
        // Process is dead or never started - clean up and reassign
        console.log(chalk.yellow(`Issue #${issue.number} has stale assignment, cleaning up and reassigning...`));
        await this.assignmentManager.deleteAssignment(existingAssignment.id);
      }
    }

    // Event logging
    this.logEvent('🎯', `Assigned #${issue.number} to ${provider}`, issue.title);

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

    // Detect if this is a phase master issue
    const isPhaseMaster = PromptBuilder.isPhaseMaster(issue.title);
    if (isPhaseMaster && this.verbose) {
      console.log(chalk.blue('📋 Phase Master detected - will use coordination workflow'));
    }

    // Create assignment
    const assignment = await this.assignmentManager.createAssignment({
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body ?? undefined,
      llmProvider: provider,
      worktreePath,
      branchName,
      requiresTests: config.requirements.testingRequired,
      requiresCI: config.requirements.ciMustPass,
      // NOTE: labels removed - read from GitHub/project instead
    });

    // Set phase master flag in metadata
    if (isPhaseMaster && assignment.metadata) {
      assignment.metadata.isPhaseMaster = true;
      // No save needed - in-memory only
    }

    // Link assignment to project item if project integration enabled
    if (this.projectsAPI) {
      await this.assignmentManager.ensureProjectItemId(assignment.id);
      console.log(chalk.gray('✓ Linked to project'));
    }

    // Assign GitHub issue to user
    if (this.githubAPI) {
      const llmConfig = this.configManager.getLLMConfig(provider);
      const assigneeUsername = llmConfig.user;

      if (assigneeUsername) {
        try {
          await this.githubAPI.assignIssue(issue.number, [assigneeUsername]);
          console.log(chalk.gray(`✓ Assigned to @${assigneeUsername}`));
        } catch (error) {
          console.log(chalk.yellow(`⚠️  Could not assign to @${assigneeUsername}: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    }

    // Phase consolidation workflow temporarily disabled
    // Phase masters should not be assigned due to filtering in fetchAvailableIssues()
    // const isPhaseMasterIssue = this.epicOrchestrator &&
    //                            this.phaseConsolidationWorker &&
    //                            this.isPhaseMaster(issue.title);

    // if (isPhaseMasterIssue) {
    //   // This is a phase master - route to phase consolidation workflow
    //   console.log(chalk.blue('📋 Phase Master detected - starting consolidation workflow...'));

    //   // Update status to in-progress
    //   await this.assignmentManager.updateAssignment(assignment.id, {
    //     status: 'in-progress',
    //   });

    //   if (this.projectsAPI) {
    //     await this.assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
    //     await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, 'phase-consolidation');
    //   }

    //   // Start phase consolidation in background
    //   this.phaseConsolidationWorker?.consolidatePhase(assignment).catch(error => {
    //     console.error(chalk.red(`Phase consolidation error for #${issue.number}: ${error}`));
    //   });

    //   console.log(chalk.green(`✓ Assignment created and phase consolidation started`));
    //   return;
    // }

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

    // Get the process ID
    const status = await adapter.getStatus(assignment.llmInstanceId);
    const processId = status?.processId;

    // Update assignment with PID and status (with project sync if enabled)
    if (this.projectsAPI) {
      // Update process ID first (don't set status here, updateStatusWithSync will do it)
      await this.assignmentManager.updateAssignment(assignment.id, {
        processId,
      });
      // Set status and sync to GitHub
      await this.assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
      // Update "Assigned Instance" field in GitHub Project
      await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, assignment.llmInstanceId);

      // Epic Mode: If this is a phase master, assign all work items in the phase to same instance
      if (this.epicOrchestrator && isPhaseMaster) {
        await this.assignPhaseWorkItems(assignment, assignment.llmInstanceId);
      }
    } else {
      await this.assignmentManager.updateAssignment(assignment.id, {
        status: 'in-progress',
        processId,
      });
    }

    // Add work session
    await this.assignmentManager.addWorkSession(assignment.id, {
      startedAt: new Date().toISOString(),
      promptUsed: prompt,
    });

    console.log(chalk.green(`✓ Assignment created and ${provider} instance started`));

    // PTY mode now handles real-time output directly - no need for log monitoring
    // Legacy tail-based monitoring disabled in favor of PTY streaming
  }

  /**
   * Assign all work items in a phase to the same instance as the phase master
   * Epic Mode only - when phase master is assigned, assign all Phase N.x items
   * This updates the GitHub Project view directly, not just local assignments
   */
  private async assignPhaseWorkItems(masterAssignment: Assignment, instanceId: string): Promise<void> {
    if (!this.epicOrchestrator || !this.projectsAPI || !this.fieldMapper) {
      return;
    }

    // Extract phase number from master title (e.g., "Phase 1" from "[Epic] Phase 1: Name - MASTER")
    const phaseMatch = masterAssignment.issueTitle.match(/Phase\s+(\d+)/i);
    if (!phaseMatch) {
      if (this.verbose) {
        console.log(chalk.yellow(`  ⚠️  Could not extract phase number from: ${masterAssignment.issueTitle}`));
      }
      return;
    }

    const phaseNumber = parseInt(phaseMatch[1], 10);
    console.log(chalk.blue(`\n📋 Assigning Phase ${phaseNumber} work items to instance: ${instanceId}`));

    // Since we don't have direct access to all project items, we'll need to fetch
    // epic items from the project and filter them
    if (!this.githubAPI) {
      console.log(chalk.yellow(`  ⚠️  GitHub API not available - cannot assign work items`));
      return;
    }

    // Fetch all project items (no filters = all items)
    const queryResult = await this.projectsAPI.queryItems();
    const allProjectItems = queryResult.items;

    // Get epic name from orchestrator config
    const epicConfig = this.epicOrchestrator as any; // Access config
    const epicName = epicConfig.config?.epicName || '';

    if (!epicName) {
      console.log(chalk.yellow(`  ⚠️  Epic name not configured - cannot filter work items`));
      return;
    }

    // Filter for Phase N.x work items (not the master)
    const phasePattern = new RegExp(`Phase\s+${phaseNumber}\\.\\d+`, 'i');
    const epicPattern = new RegExp(epicName, 'i');

    const phaseWorkItems: Array<{ issueNumber: number; title: string; projectItemId: string }> = [];
    for (const item of allProjectItems) {
      const title = item.content?.title || '';
      const issueNumber = item.content?.number;

      if (item.id && issueNumber && epicPattern.test(title)) {
        if (phasePattern.test(title)) {
          phaseWorkItems.push({
            issueNumber,
            title,
            projectItemId: item.id,
          });
        }
      }
    }

    if (phaseWorkItems.length === 0) {
      console.log(chalk.gray(`  No work items found for Phase ${phaseNumber}`));
      return;
    }

    console.log(chalk.gray(`  Found ${phaseWorkItems.length} work item(s) for Phase ${phaseNumber}`));

    // Assign all work items to the same instance in GitHub Project
    for (const workItem of phaseWorkItems) {
      try {
        // Update directly in GitHub Project using the project item ID
        await this.projectsAPI.updateAssignedInstance(workItem.projectItemId, instanceId);
        console.log(chalk.gray(`  ✓ #${workItem.issueNumber}: ${workItem.title.substring(0, 60)}...`));
      } catch (error) {
        console.log(chalk.yellow(`  ⚠️  Failed to assign #${workItem.issueNumber}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
  }

  /**
   * Detect if an issue is a phase work item (Phase N.x format)
   */
  private isPhaseWorkItem(issueTitle: string): boolean {
    // Must match "Phase N.x" pattern (decimal indicates work item)
    return /Phase\s+\d+\.\d+/i.test(issueTitle);
  }

  /**
   * Monitoring loop
   * Checks for completion via hooks (primary) and dead processes (fallback)
   * Syncs from GitHub periodically to detect manual status changes
   */
  private async startMonitoringLoop(): Promise<void> {
    console.log(chalk.blue('\nStarting monitoring loop...\n'));
    console.log(chalk.gray('  Checking for completion every 60s'));
    console.log(chalk.gray('  Checking for dead processes every 3m'));
    console.log(chalk.gray('  Syncing from GitHub every 5m\n'));

    let githubSyncCycleCount = 0;
    let evaluationCycleCount = 0;
    let resurrectionCycleCount = 0;

    while (this.isRunning) {
      try {
        await this.checkAssignments();

        // Process dev-complete items with merge worker
        if (this.mergeWorker) {
          await this.mergeWorker.processDevCompleteItems(!!this.epicOrchestrator);
        }

        // Check for dead processes every 3 minutes (3 cycles) and resurrect them
        resurrectionCycleCount++;
        if (resurrectionCycleCount >= 3) {
          if (this.verbose) {
            console.log(chalk.gray('\n  🔄 Periodic dead process check...'));
          }
          await this.resurrectDeadAssignments();
          resurrectionCycleCount = 0;
        }

        // Sync from GitHub every 5 minutes (5 cycles) to detect manual changes
        githubSyncCycleCount++;
        if (githubSyncCycleCount >= 5) {
          if (this.verbose) {
            console.log(chalk.gray('\n  🔄 Periodic comprehensive sync from GitHub...'));
          }
          if (this.projectsAPI && this.fieldMapper) {
            try {
              const config = this.configManager.getConfig();
              await this.assignmentManager.syncAllFieldsFromGitHub({
                assignedInstanceFieldName: config.project?.fields.assignedInstance?.fieldName || 'Assigned Instance',
                readyStatuses: config.project?.fields.status.readyValues || ['Ready'],
                completeStatuses: ['dev-complete', 'stage-ready', 'merged'],
              });
            } catch (error) {
              console.warn(chalk.yellow('⚠️  Periodic sync failed:'), error instanceof Error ? error.message : String(error));
            }
          }
          githubSyncCycleCount = 0;
        }

        // Periodically evaluate new/updated issues every 10 minutes (10 cycles)
        evaluationCycleCount++;
        if (evaluationCycleCount >= 10) {
          await this.performPeriodicEvaluationAndAssignment();
          evaluationCycleCount = 0;
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
   * Fetch issues that need AI evaluation (status = "Evaluate")
   */
  private async fetchIssuesNeedingEvaluation(): Promise<Issue[]> {
    if (!this.githubAPI || !this.projectsAPI) {
      return [];
    }

    const config = this.configManager.getConfig();
    const evaluateStatus = config.project?.fields.status.evaluateValue;

    // If no evaluateValue configured, skip evaluation entirely
    if (!evaluateStatus) {
      if (this.verbose) {
        console.log(chalk.gray('  No "evaluateValue" configured - skipping AI evaluation'));
      }
      return [];
    }

    try {
      // Query ALL items with "Evaluate" status (not just first 100)
      const allItems = await this.projectsAPI.getAllItems({
        status: [evaluateStatus],
      });

      if (this.verbose) {
        console.log(chalk.gray(`  Found ${allItems.length} items with "${evaluateStatus}" status`));
      }

      // Filter by epic if epic mode is enabled
      let epicFilteredEvalItems = allItems;
      if (this.epicOrchestrator && this.fieldMapper) {
        const itemsWithMetadata = allItems.map(item => this.fieldMapper!.mapItemWithMetadata(item));
        const epicItems = this.epicOrchestrator.filterEpicItems(itemsWithMetadata);
        const epicIssueNumbers = new Set(epicItems.map(item => item.issueNumber));
        epicFilteredEvalItems = allItems.filter(item => epicIssueNumbers.has(item.content.number));

        if (this.verbose && epicFilteredEvalItems.length < allItems.length) {
          console.log(chalk.gray(`  Epic filter: ${epicFilteredEvalItems.length}/${allItems.length} items match epic`));
        }
      }

      // Fetch full issue details
      const issues: Issue[] = [];
      for (const item of epicFilteredEvalItems) {
        try {
          const issue = await this.githubAPI.getIssue(item.content.number);
          issues.push(issue);
        } catch (error) {
          console.warn(chalk.yellow(`  Could not fetch issue #${item.content.number}: ${error}`));
        }
      }

      return issues;
    } catch (error) {
      console.warn(chalk.yellow(`  Error fetching items needing evaluation: ${error}`));
      return [];
    }
  }

  /**
   * Perform periodic evaluation and assignment of issues
   * NEW BEHAVIOR: Only evaluates items with "Evaluate" status
   * Ready/Todo/Evaluated items skip evaluation and go straight to assignment
   */
  private async performPeriodicEvaluationAndAssignment(): Promise<void> {
    if (!this.isRunning) return;

    console.log(chalk.blue('\n🔍 Performing periodic check for work...'));

    // Step 1: Check for items needing AI evaluation (status = "Evaluate")
    const itemsToEvaluate = await this.fetchIssuesNeedingEvaluation();

    if (itemsToEvaluate.length > 0) {
      console.log(chalk.blue(`  📊 Evaluating ${itemsToEvaluate.length} item(s) with "Evaluate" status...`));

      let evaluated: IssueEvaluation[];
      let skipped: Issue[];
      try {
        const result = await this.issueEvaluator.evaluateIssues(itemsToEvaluate, {
          verbose: this.verbose,
        });
        evaluated = result.evaluated;
        skipped = result.skipped;
      } catch (error) {
        console.error(
          chalk.yellow('⚠️  Error evaluating issues:'),
          error instanceof Error ? error.message : String(error)
        );
        return;
      }

      // Update project fields and labels for evaluated issues
      if (evaluated.length > 0 && this.projectsAPI && this.fieldMapper && this.githubAPI) {
        await this.updateProjectFieldsAfterEvaluation(evaluated);
      }

      if (skipped.length > 0) {
        console.log(chalk.yellow(`  ⚠️  ${skipped.length} issue(s) need more detail (moved to "Needs more info")`));
      }

      if (evaluated.length > 0) {
        console.log(chalk.green(`  ✓ Evaluated ${evaluated.length} issue(s) → moved to "Evaluated" status`));
      }
    }

    // Step 2: Fetch and assign ready issues (Ready/Todo/Evaluated)
    let readyIssues: Issue[] = [];
    try {
      readyIssues = await this.fetchAvailableIssues();
    } catch (error) {
      console.error(
        chalk.yellow('⚠️  Error fetching ready issues:'),
        error instanceof Error ? error.message : String(error)
      );
      return;
    }

    if (readyIssues.length === 0) {
      if (this.verbose) {
        console.log(chalk.gray('  No ready issues available for assignment.'));
      }
      return;
    }

    // Assign ready issues (no evaluation needed - they're already Ready/Todo/Evaluated!)
    console.log(chalk.green(`  📋 Found ${readyIssues.length} ready issue(s) for assignment`));
    await this.assignIssues(readyIssues);
  }



  /**
   * Check all active assignments
   */
  private async checkAssignments(): Promise<void> {
    const activeAssignments = this.assignmentManager.getAssignmentsByStatus('in-progress');

    for (const assignment of activeAssignments) {
      await this.checkAssignment(assignment);
    }

    // Check for dev-complete assignments - these free up LLM slots for new work
    const devCompleteAssignments = this.assignmentManager.getAssignmentsByStatus('dev-complete');
    if (devCompleteAssignments.length > 0) {
      try {
        // Fetch new issues and assign (dev-complete items no longer use LLM resources)
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

      // Check if process is actually running
      if (status.processId && !isProcessRunning(status.processId)) {
        // Process has exited - check for completion signals and indicators
        const logPath = join(this.autonomousDataDir, `output-${assignment.llmInstanceId}.log`);

        // PRIMARY: Check for explicit autonomous signals (most reliable)
        const autonomousSignals = detectAutonomousSignals(logPath);

        // SECONDARY: Pattern-based session analysis (fallback)
        const sessionAnalysis = detectSessionCompletion(logPath);

        // For phase masters, PR creation is a strong completion signal
        const isPhaseMaster = assignment.metadata?.isPhaseMaster === true;
        const prNumber = autonomousSignals.prNumber || extractPRNumber(logPath);
        const hasPR = prNumber !== undefined;

        // Handle explicit BLOCKED signal - needs human intervention
        if (autonomousSignals.isBlocked) {
          console.log(chalk.yellow(`\n⏸️  Session blocked for issue #${assignment.issueNumber}`));
          console.log(chalk.gray(`   Instance: ${assignment.llmInstanceId}`));
          console.log(chalk.gray(`   Reason: ${autonomousSignals.blockedReason || 'No reason provided'}`));

          // Post comment to GitHub about blocked status
          if (this.githubAPI) {
            try {
              await this.githubAPI.createComment(assignment.issueNumber,
                `## ⏸️ Autonomous Work Blocked\n\n**Reason:** ${autonomousSignals.blockedReason || 'Needs human clarification'}\n\nPlease provide additional context or guidance in the issue comments, then change status back to "In Progress" to resume.`
              );
            } catch (error) {
              if (this.verbose) {
                console.log(chalk.yellow(`   ⚠️  Could not post comment: ${error}`));
              }
            }
          }

          // Update to a blocked status (keep as in-progress but clear instance)
          await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
          return; // Don't resurrect
        }

        // Handle explicit FAILED signal - work couldn't be completed
        if (autonomousSignals.isFailed) {
          console.log(chalk.red(`\n❌ Session failed for issue #${assignment.issueNumber}`));
          console.log(chalk.gray(`   Instance: ${assignment.llmInstanceId}`));
          console.log(chalk.gray(`   Reason: ${autonomousSignals.failedReason || 'No reason provided'}`));

          // Post comment to GitHub about failure
          if (this.githubAPI) {
            try {
              await this.githubAPI.createComment(assignment.issueNumber,
                `## ❌ Autonomous Work Failed\n\n**Reason:** ${autonomousSignals.failedReason || 'Unrecoverable error'}\n\nManual intervention may be required.`
              );
            } catch (error) {
              if (this.verbose) {
                console.log(chalk.yellow(`   ⚠️  Could not post comment: ${error}`));
              }
            }
          }

          // Clear instance but don't resurrect
          await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
          return; // Don't resurrect
        }

        // Check for completion: explicit signal OR pattern matching OR (phase master + PR)
        const isComplete = autonomousSignals.isComplete ||
          sessionAnalysis.isComplete ||
          (isPhaseMaster && hasPR);

        if (isComplete) {
          // SUCCESS: Session completed normally
          console.log(chalk.green(`\n✓ Session completed successfully for issue #${assignment.issueNumber}`));
          console.log(chalk.gray(`   Instance: ${assignment.llmInstanceId}`));

          if (autonomousSignals.isComplete) {
            console.log(chalk.gray(`   Detection: Explicit AUTONOMOUS_SIGNAL:COMPLETE`));
          } else if (isPhaseMaster && hasPR) {
            console.log(chalk.gray(`   Detection: Phase master with PR #${prNumber} created`));
          } else if (sessionAnalysis.isComplete) {
            console.log(chalk.gray(`   Detection: Pattern matching (${sessionAnalysis.indicators.slice(0, 3).join(', ')})`));
          }

          // Update assignment status to dev-complete
          await this.assignmentManager.updateAssignment(assignment.id, {
            status: 'dev-complete',
            completedAt: new Date().toISOString(),
          });

          // Update GitHub project status and clear assigned instance
          if (this.projectsAPI) {
            try {
              if (!assignment.projectItemId) {
                throw new Error('No projectItemId on assignment');
              }

              const devCompleteStatus = 'Dev Complete';
              await this.projectsAPI.updateItemStatusByValue(
                assignment.projectItemId,
                devCompleteStatus
              );
              console.log(chalk.green(`   ✓ Updated GitHub project status to "Dev Complete"`));

              // Clear assigned instance since work is complete
              await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
            } catch (error) {
              if (this.verbose) {
                console.log(chalk.yellow(`   ⚠️  Could not update project status: ${error}`));
              }
            }
          }

          // Add final work session
          await this.assignmentManager.addWorkSession(assignment.id, {
            endedAt: new Date().toISOString(),
            summary: 'Work completed',
          });

          if (prNumber) {
            console.log(chalk.blue(`   PR created: #${prNumber}`));
          }
        } else {
          // Before resurrecting, run AI review to check if work is actually complete
          console.log(chalk.blue(`   Running AI review to assess completion status...`));

          if (this.reviewWorker && this.githubAPI) {
            try {
              const reviewResult = await this.reviewWorker.reviewByIssueNumber(assignment.issueNumber, {
                branch: assignment.branchName,
                quiet: true,
                useCurrentDirectory: false,
              });

              if (reviewResult && reviewResult.passed) {
                // Work is actually complete!
                console.log(chalk.green(`   ✓ AI Review: Work is complete!`));

                // Check if this is a phase work item (should NOT go to dev-complete)
                const isPhaseWorkItem = !!this.epicOrchestrator && this.isPhaseWorkItem(assignment.issueTitle);

                if (isPhaseWorkItem) {
                  // Phase work item: Keep as in-progress but clear assigned instance
                  console.log(chalk.blue(`   Phase work item - keeping status as In Progress`));

                  if (this.projectsAPI) {
                    await this.assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
                    await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
                  } else {
                    await this.assignmentManager.updateAssignment(assignment.id, {
                      completedAt: new Date().toISOString(),
                    });
                  }

                  console.log(chalk.green(`   ✓ Phase work item complete (awaiting phase master merge)`));
                } else {
                  // Normal mode OR phase master: Mark as dev-complete
                  console.log(chalk.green(`   Marking as Dev Complete`));

                  await this.assignmentManager.updateAssignment(assignment.id, {
                    status: 'dev-complete',
                    completedAt: new Date().toISOString(),
                  });

                  // Update GitHub project status
                  if (this.projectsAPI && this.fieldMapper) {
                    try {
                      const projectMetadata = await this.fieldMapper.getMetadataForIssues([assignment.issueNumber]);
                      const metadata = projectMetadata.get(assignment.issueNumber);
                      if (metadata?.projectItemId) {
                        await this.projectsAPI.updateItemStatusByValue(
                          metadata.projectItemId,
                          'Dev Complete'
                        );
                        console.log(chalk.green(`   ✓ Updated GitHub project status to "Dev Complete"`));

                        // Clear assigned instance since work is complete
                        await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
                      }
                    } catch (error) {
                      if (this.verbose) {
                        console.log(chalk.yellow(`   ⚠️  Could not update project status: ${error}`));
                      }
                    }
                  }
                }

                // Add final work session
                await this.assignmentManager.addWorkSession(assignment.id, {
                  endedAt: new Date().toISOString(),
                  summary: 'Work completed',
                });

                if (prNumber) {
                  console.log(chalk.blue(`   📋 PR #${prNumber} created`));
                }
              } else if (reviewResult && !reviewResult.passed) {
                // Work is incomplete - document what's left and resurrect
                const failureReasons = reviewResult.reviewResult.failureReasons || [];
                const remainingWork = failureReasons.join('\n- ');

                console.log(chalk.yellow(`   ⚠️  AI Review: Work incomplete`));
                console.log(chalk.gray(`   Remaining work:\n   - ${remainingWork}`));

                // Post comment to GitHub documenting resurrection state
                if (this.githubAPI) {
                  try {
                    const comment = `## 🔄 Process Resurrected

**Status:** Work in progress detected after process termination

**AI Review Findings:**
${failureReasons.map(r => `- ${r}`).join('\n')}

**Next Steps:**
The autonomous system is resuming work on this issue. The LLM will address the remaining items identified above.

---
*Automated resurrection at ${new Date().toISOString()}*`;

                    await this.githubAPI.createComment(assignment.issueNumber, comment);
                    console.log(chalk.gray(`   ✓ Posted resurrection status to GitHub issue`));
                  } catch (error) {
                    if (this.verbose) {
                      console.log(chalk.yellow(`   ⚠️  Could not post comment: ${error}`));
                    }
                  }
                }
              }
            } catch (error) {
              // Review failed - proceed with resurrection anyway
              console.log(chalk.yellow(`   ⚠️  Review failed, proceeding with resurrection`));
              if (this.verbose) {
                console.log(chalk.gray(`   Error: ${error instanceof Error ? error.message : String(error)}`));
              }
            }
          }

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

          // Update assignment with new instance ID and process ID
          const newStatus = await adapter.getStatus(newInstanceId);
          assignment.llmInstanceId = newInstanceId;
          assignment.processId = newStatus.processId || undefined;

          await this.assignmentManager.updateAssignment(assignment.id, {
            lastActivity: new Date().toISOString(),
            processId: newStatus.processId,
          });

          // Update "Assigned Instance" field in project to new instance ID
          if (this.projectsAPI && this.fieldMapper) {
            try {
              const projectMetadata = await this.fieldMapper.getMetadataForIssues([assignment.issueNumber]);
              const metadata = projectMetadata.get(assignment.issueNumber);
              if (metadata?.projectItemId) {
                const assignedInstanceField = this.configManager.getConfig().project?.fields.assignedInstance;
                if (assignedInstanceField) {
                  await this.projectsAPI.updateItemTextField(
                    metadata.projectItemId,
                    assignedInstanceField.fieldName,
                    newInstanceId
                  );
                }
              }
            } catch (error) {
              console.log(chalk.yellow(`   ⚠️  Could not update Assigned Instance field in project`));
            }
          }

          // Add a new work session for the resurrection
          await this.assignmentManager.addWorkSession(assignment.id, {
            startedAt: new Date().toISOString(),
            promptUsed: prompt,
            summary: 'Process resurrected after unexpected termination',
          });

          console.log(chalk.green(`✓ Process resurrected with new instance: ${newInstanceId}`));

          // Wait 5 seconds for process to stabilize and start properly
          console.log(chalk.gray('   Waiting for process to stabilize...'));
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Verify the process is actually running after stabilization period
          if (newStatus.processId && !isProcessRunning(newStatus.processId)) {
            console.log(chalk.yellow(`   ⚠️  Warning: Resurrected process ${newStatus.processId} is not running after 5s`));
            console.log(chalk.gray('   The process may need more time or failed to start properly'));
          } else if (this.verbose) {
            console.log(chalk.green('   ✓ Process verified running'));
          }

          // PTY mode handles real-time output directly (no log monitoring needed)
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
    // FIRST: Sync ALL assignment statuses from GitHub Project
    // This ensures we don't try to resurrect items that were manually moved to
    // "Dev Complete", "Evaluate", "Needs More Info", etc. by the user
    if (this.projectsAPI) {
      if (this.verbose) {
        console.log(chalk.gray('Syncing assignment statuses from GitHub before checking for dead processes...'));
      }
      try {
        await this.assignmentManager.syncStatusFromGitHub();
      } catch (error) {
        if (this.verbose) {
          console.warn(chalk.yellow('⚠️  Could not sync from GitHub:'), error instanceof Error ? error.message : String(error));
        }
      }
    }

    // SECOND: Check for orphaned GitHub assignments (items with assigned instances but no local assignment)
    // This handles the case where assignments.json was cleared but GitHub still has In Progress items
    if (this.projectsAPI && this.fieldMapper) {
      console.log(chalk.blue('Checking for orphaned GitHub assignments...'));
      
      try {
        const config = this.configManager.getConfig();
        const assignedInstanceFieldName = config.project?.fields.assignedInstance?.fieldName || 'Assigned Instance';
        
        // Query GitHub for ALL In Progress items (not just first 100)
        const allItems = await this.projectsAPI.getAllItems({
          status: ['In Progress'],
        });

        let orphanedCount = 0;

        for (const item of allItems) {
          // Check if item has an assigned instance
          const assignedInstance = item.fieldValues?.[assignedInstanceFieldName];
          
          if (!assignedInstance || typeof assignedInstance !== 'string') {
            continue; // No assigned instance, skip
          }

          const issueNumber = item.content?.number;
          if (!issueNumber) {
            continue;
          }

          // Check if we have a local assignment for this issue
          const existingAssignment = this.assignmentManager.getAssignmentByIssue(issueNumber);
          
          if (!existingAssignment) {
            // Orphaned assignment! GitHub has it but we don't
            console.log(chalk.yellow(`\n⚠️  Orphaned assignment detected: #${issueNumber}`));
            console.log(chalk.gray(`   GitHub has assigned instance: ${assignedInstance}`));
            console.log(chalk.gray(`   But no local assignment found - recreating...`));

            // Get issue details to recreate assignment
            if (!this.githubAPI) {
              console.error(chalk.red(`   Failed to recreate: GitHub API not available`));
              continue;
            }

            try {
              const issue = await this.githubAPI.getIssue(issueNumber);
              
              // Determine worktree path
              const projectName = basename(this.projectPath);
              const worktreePath = join(dirname(this.projectPath), `${projectName}-issue-${issueNumber}`);
              
              // Create assignment with basic info
              const newAssignment = await this.assignmentManager.createAssignment({
                issueNumber: issue.number,
                issueTitle: issue.title,
                llmProvider: 'claude', // TODO: detect from assignedInstance format
                worktreePath,
                branchName: `issue-${issueNumber}`,
              });

              // Update with GitHub-specific fields
              await this.assignmentManager.updateAssignment(newAssignment.id, {
                llmInstanceId: assignedInstance,
                status: 'in-progress',
              });

              // Also set projectItemId directly on the assignment object
              newAssignment.projectItemId = item.id;
              // No save needed - in-memory only

              console.log(chalk.green(`   ✓ Recreated local assignment: ${newAssignment.id}`));
              orphanedCount++;
            } catch (error) {
              console.error(chalk.red(`   Failed to recreate assignment: ${error instanceof Error ? error.message : String(error)}`));
            }
          }
        }

        if (orphanedCount > 0) {
          console.log(chalk.green(`\n✓ Recreated ${orphanedCount} orphaned assignment(s)\n`));
        } else if (this.verbose) {
          console.log(chalk.gray('  No orphaned assignments found'));
        }
      } catch (error) {
        console.warn(chalk.yellow('⚠️  Could not check for orphaned assignments:'), error instanceof Error ? error.message : String(error));
      }
    }

    // NOW get in-progress assignments (statuses are accurate after sync)
    const inProgressAssignments = this.assignmentManager.getAssignmentsByStatus('in-progress');

    if (inProgressAssignments.length === 0) {
      if (this.verbose) {
        console.log(chalk.gray('No in-progress assignments to check'));
      }
      return;
    }

    console.log(chalk.blue('Checking for dead processes...'));

    let resurrected = 0;
    let skippedDueToCompletion = 0;
    let cleaned = 0;
    const resurrectedThisCycle = new Set<string>(); // Track what we've already resurrected this cycle
    const failedToResurrect: Assignment[] = []; // Track assignments that can't be resurrected

    for (const assignment of inProgressAssignments) {
      // Skip if we already resurrected this assignment in this cycle
      if (resurrectedThisCycle.has(assignment.id)) {
        if (this.verbose) {
          console.log(chalk.gray(`  Skipping issue #${assignment.issueNumber} - already resurrected this cycle`));
        }
        continue;
      }

      const adapter = this.adapters.get(assignment.llmProvider);
      if (!adapter) {
        console.warn(chalk.yellow(`No adapter found for ${assignment.llmProvider}, marking for cleanup`));
        failedToResurrect.push(assignment);
        continue;
      }

      try {
        const status = await adapter.getStatus(assignment.llmInstanceId);

        // Check if process is actually running FIRST (process check is more reliable than session file)
        if (status.processId && !isProcessRunning(status.processId)) {
          // Process has exited - check for completion signals and indicators
          const logPath = join(this.autonomousDataDir, `output-${assignment.llmInstanceId}.log`);

          // PRIMARY: Check for explicit autonomous signals (most reliable)
          const autonomousSignals = detectAutonomousSignals(logPath);

          // SECONDARY: Pattern-based session analysis (fallback)
          const sessionAnalysis = detectSessionCompletion(logPath);

          // For phase masters, PR creation is a strong completion signal
          const isPhaseMaster = assignment.metadata?.isPhaseMaster === true;
          const prNumber = autonomousSignals.prNumber || extractPRNumber(logPath);
          const hasPR = prNumber !== undefined;

          // Handle explicit BLOCKED or FAILED signals
          if (autonomousSignals.isBlocked || autonomousSignals.isFailed) {
            console.log(chalk.yellow(`\n⏸️  Session ended with ${autonomousSignals.isBlocked ? 'BLOCKED' : 'FAILED'} signal for issue #${assignment.issueNumber}`));
            console.log(chalk.gray(`   Instance: ${assignment.llmInstanceId}`));
            console.log(chalk.gray(`   Reason: ${autonomousSignals.blockedReason || autonomousSignals.failedReason || 'Not specified'}`));

            // Clear instance but don't resurrect
            await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
            skippedDueToCompletion++;
            continue;
          }

          // Check for completion: explicit signal OR pattern matching OR (phase master + PR)
          const isComplete = autonomousSignals.isComplete ||
            sessionAnalysis.isComplete ||
            (isPhaseMaster && hasPR);

          if (isComplete) {
            // SUCCESS: Session completed normally, not a dead process
            console.log(chalk.green(`\n✓ Session completed successfully for issue #${assignment.issueNumber}`));
            console.log(chalk.gray(`   Instance: ${assignment.llmInstanceId}`));

            if (autonomousSignals.isComplete) {
              console.log(chalk.gray(`   Detection: Explicit AUTONOMOUS_SIGNAL:COMPLETE`));
            } else if (isPhaseMaster && hasPR) {
              console.log(chalk.gray(`   Detection: Phase master with PR #${prNumber} created`));
            } else if (sessionAnalysis.isComplete) {
              console.log(chalk.gray(`   Detection: Pattern matching (${sessionAnalysis.indicators.slice(0, 3).join(', ')})`));
            }

            // Update assignment status to dev-complete
            await this.assignmentManager.updateAssignment(assignment.id, {
              status: 'dev-complete',
              completedAt: new Date().toISOString(),
            });

            // Update GitHub project status and clear assigned instance
            if (this.projectsAPI) {
              try {
                if (!assignment.projectItemId) {
                  throw new Error('No projectItemId on assignment');
                }

                const devCompleteStatus = 'Dev Complete';
                await this.projectsAPI.updateItemStatusByValue(
                  assignment.projectItemId,
                  devCompleteStatus
                );
                console.log(chalk.green(`   ✓ Updated GitHub project status to "Dev Complete"`));

                // Clear assigned instance since work is complete
                await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
              } catch (error) {
                if (this.verbose) {
                  console.log(chalk.yellow(`   ⚠️  Could not update project status: ${error}`));
                }
              }
            }

            skippedDueToCompletion++;
            continue;
          } else {
            // Process exited but work is NOT complete - this is a dead process
            console.log(chalk.yellow(`\n⚠️  Dead process detected for issue #${assignment.issueNumber}`));
            console.log(chalk.gray(`   Instance: ${assignment.llmInstanceId}`));
            console.log(chalk.gray(`   Process ID: ${status.processId} (not running)`));

            // Check if process is a zombie (defunct)
            const isZombie = isZombieProcess(status.processId);
            if (isZombie) {
              console.log(chalk.gray(`   Process is a zombie (defunct) - will attempt resurrection`));
            }
          }

          // Before resurrecting, run AI review to check if work is actually complete
          console.log(chalk.blue(`   Running AI review to assess completion status...`));

          if (this.reviewWorker && this.githubAPI) {
            try {
              const reviewResult = await this.reviewWorker.reviewByIssueNumber(assignment.issueNumber, {
                branch: assignment.branchName,
                quiet: true,
                useCurrentDirectory: false,
              });

              if (reviewResult && reviewResult.passed) {
                // Work is actually complete!
                console.log(chalk.green(`   ✓ AI Review: Work is complete!`));

                // Check if this is a phase work item (should NOT go to dev-complete)
                const isPhaseWorkItem = !!this.epicOrchestrator && this.isPhaseWorkItem(assignment.issueTitle);

                if (isPhaseWorkItem) {
                  // Phase work item: Keep as in-progress but clear assigned instance
                  console.log(chalk.blue(`   Phase work item - keeping status as In Progress`));

                  if (this.projectsAPI) {
                    await this.assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
                    await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
                  } else {
                    await this.assignmentManager.updateAssignment(assignment.id, {
                      completedAt: new Date().toISOString(),
                    });
                  }

                  console.log(chalk.green(`   ✓ Phase work item complete (awaiting phase master merge)`));
                } else {
                  // Normal mode OR phase master: Mark as dev-complete
                  console.log(chalk.green(`   Marking as Dev Complete`));

                  await this.assignmentManager.updateAssignment(assignment.id, {
                    status: 'dev-complete',
                    completedAt: new Date().toISOString(),
                  });

                  // Update GitHub project status
                  if (this.projectsAPI && this.fieldMapper) {
                    try {
                      const projectMetadata = await this.fieldMapper.getMetadataForIssues([assignment.issueNumber]);
                      const metadata = projectMetadata.get(assignment.issueNumber);
                      if (metadata?.projectItemId) {
                        await this.projectsAPI.updateItemStatusByValue(
                          metadata.projectItemId,
                          'Dev Complete'
                        );
                        console.log(chalk.green(`   ✓ Updated GitHub project status to "Dev Complete"`));

                        // Clear assigned instance since work is complete
                        await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
                      }
                    } catch (error) {
                      if (this.verbose) {
                        console.log(chalk.yellow(`   ⚠️  Could not update project status: ${error}`));
                      }
                    }
                  }
                }

                // Add final work session
                await this.assignmentManager.addWorkSession(assignment.id, {
                  endedAt: new Date().toISOString(),
                  summary: 'Work completed',
                });

                if (prNumber) {
                  console.log(chalk.blue(`   📋 PR #${prNumber} created`));
                }
              } else if (reviewResult && !reviewResult.passed) {
                // Work is incomplete - document what's left and resurrect
                const failureReasons = reviewResult.reviewResult.failureReasons || [];
                const remainingWork = failureReasons.join('\n- ');

                console.log(chalk.yellow(`   ⚠️  AI Review: Work incomplete`));
                console.log(chalk.gray(`   Remaining work:\n   - ${remainingWork}`));

                // Post comment to GitHub documenting resurrection state
                if (this.githubAPI) {
                  try {
                    const comment = `## 🔄 Process Resurrected

**Status:** Work in progress detected after process termination

**AI Review Findings:**
${failureReasons.map(r => `- ${r}`).join('\n')}

**Next Steps:**
The autonomous system is resuming work on this issue. The LLM will address the remaining items identified above.

---
*Automated resurrection at ${new Date().toISOString()}*`;

                    await this.githubAPI.createComment(assignment.issueNumber, comment);
                    console.log(chalk.gray(`   ✓ Posted resurrection status to GitHub issue`));
                  } catch (error) {
                    if (this.verbose) {
                      console.log(chalk.yellow(`   ⚠️  Could not post comment: ${error}`));
                    }
                  }
                }
              }
            } catch (error) {
              // Review failed - proceed with resurrection anyway
              console.log(chalk.yellow(`   ⚠️  Review failed, proceeding with resurrection`));
              if (this.verbose) {
                console.log(chalk.gray(`   Error: ${error instanceof Error ? error.message : String(error)}`));
              }
            }
          }

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

          // Update assignment with new instance ID and process ID
          const newStatus = await adapter.getStatus(newInstanceId);
          assignment.llmInstanceId = newInstanceId;
          assignment.processId = newStatus.processId || undefined;

          await this.assignmentManager.updateAssignment(assignment.id, {
            lastActivity: new Date().toISOString(),
            processId: newStatus.processId,
          });

          // Update "Assigned Instance" field in project to new instance ID
          if (this.projectsAPI && this.fieldMapper) {
            try {
              const projectMetadata = await this.fieldMapper.getMetadataForIssues([assignment.issueNumber]);
              const metadata = projectMetadata.get(assignment.issueNumber);
              if (metadata?.projectItemId) {
                const assignedInstanceField = this.configManager.getConfig().project?.fields.assignedInstance;
                if (assignedInstanceField) {
                  await this.projectsAPI.updateItemTextField(
                    metadata.projectItemId,
                    assignedInstanceField.fieldName,
                    newInstanceId
                  );
                }
              }
            } catch (error) {
              console.log(chalk.yellow(`   ⚠️  Could not update Assigned Instance field in project`));
            }
          }

          // Add a new work session for the resurrection
          await this.assignmentManager.addWorkSession(assignment.id, {
            startedAt: new Date().toISOString(),
            promptUsed: prompt,
            summary: 'Process resurrected after unexpected termination',
          });

          console.log(chalk.green(`✓ Process resurrected with new instance: ${newInstanceId}`));
          resurrected++;

          // Mark as resurrected this cycle to prevent double-resurrection
          resurrectedThisCycle.add(assignment.id);

          // Wait 5 seconds for process to stabilize and start properly
          console.log(chalk.gray('   Waiting for process to stabilize...'));
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Get updated status after wait
          const updatedStatus = await adapter.getStatus(newInstanceId);
          if (updatedStatus.processId && !isProcessRunning(updatedStatus.processId)) {
            console.log(chalk.yellow(`   ⚠️  Warning: Started process ${updatedStatus.processId} is not running after 5s`));
            console.log(chalk.gray('   The process may need more time or failed to start properly'));
          } else if (this.verbose) {
            console.log(chalk.green('   ✓ Process verified running'));
          }

          // PTY mode handles real-time output directly (no log monitoring needed)
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

          // Mark as resurrected this cycle to prevent double-resurrection
          resurrectedThisCycle.add(assignment.id);

          // Wait 5 seconds for process to stabilize and start properly
          console.log(chalk.gray('   Waiting for process to stabilize...'));
          await new Promise(resolve => setTimeout(resolve, 5000));

          // Get updated status after wait
          const updatedStatus = await adapter.getStatus(newInstanceId);
          if (updatedStatus.processId && !isProcessRunning(updatedStatus.processId)) {
            console.log(chalk.yellow(`   ⚠️  Warning: Started process ${updatedStatus.processId} is not running after 5s`));
            console.log(chalk.gray('   The process may need more time or failed to start properly'));
          } else if (this.verbose) {
            console.log(chalk.green('   ✓ Process verified running'));
          }

          // PTY mode handles real-time output directly (no log monitoring needed)
        } else if (!status.isRunning) {
          // Session file says not running, and process check passed (or no processId)
          // This means the session legitimately completed via hook
          if (this.verbose) {
            console.log(chalk.gray(`  Instance ${assignment.llmInstanceId}: Session completed normally`));
          }
        }
      } catch (error) {
        console.error(
          chalk.red(`Failed to resurrect assignment for issue #${assignment.issueNumber}:`),
          error instanceof Error ? error.message : String(error)
        );
        failedToResurrect.push(assignment);
      }
    }

    // Clean up assignments that couldn't be resurrected
    if (failedToResurrect.length > 0 && this.projectsAPI) {
      console.log(chalk.yellow(`\n⚠️  Cleaning up ${failedToResurrect.length} failed assignment(s)...`));

      const config = this.configManager.getConfig();
      const readyStatus = config.project?.fields.status.readyValues?.[0] || 'Ready';

      for (const assignment of failedToResurrect) {
        try {
          console.log(chalk.gray(`   Cleaning up #${assignment.issueNumber}`));

          // Set status back to Ready in GitHub
          if (assignment.projectItemId) {
            await this.projectsAPI.updateItemStatusByValue(assignment.projectItemId, readyStatus);
            console.log(chalk.gray(`      ✓ Status set to "${readyStatus}"`));

            // Clear assigned instance in GitHub
            if (this.projectsAPI.updateAssignedInstance) {
              await this.projectsAPI.updateAssignedInstance(assignment.projectItemId, null);
              console.log(chalk.gray(`      ✓ Assigned instance cleared`));
            }
          }

          // Delete local assignment
          await this.assignmentManager.deleteAssignment(assignment.id);
          console.log(chalk.gray(`      ✓ Removed from local assignments`));

          cleaned++;
        } catch (error) {
          console.error(chalk.red(`   Failed to clean up #${assignment.issueNumber}:`), error instanceof Error ? error.message : String(error));
        }
      }

      if (cleaned > 0) {
        console.log(chalk.green(`\n✓ Cleaned up ${cleaned} orphaned assignment(s)`));
      }
    }

    if (resurrected > 0 || skippedDueToCompletion > 0 || cleaned > 0) {
      if (resurrected > 0) {
        console.log(chalk.green(`\n✓ Resurrected ${resurrected} process(es)`));
      }
      if (skippedDueToCompletion > 0) {
        console.log(chalk.blue(`ℹ️  Skipped ${skippedDueToCompletion} completed session(s) (detected via log analysis)`));
      }
      console.log('');
    } else {
      console.log(chalk.green('✓ All processes are running\n'));
    }
  }

  /**
   * Create LLM adapter
   */
  private createAdapter(provider: LLMProvider, config: LLMConfig): LLMAdapter {
    switch (provider) {
      case 'claude':
        return new ClaudeAdapter(config, this.autonomousDataDir, this.verbose);
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
   * TODO: Currently unused - was part of old completion flow. Can be re-enabled if needed.
   */
  // @ts-expect-error - Unused but kept for future use
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
      const config = this.configManager.getConfig();
      const issueTypeConfig = config.project?.fields.issueType;

      // Get Issue Type from project if configured
      if (issueTypeConfig) {
        const issueType = await this.projectsAPI.getItemSelectFieldValue(
          projectItemId,
          issueTypeConfig.fieldName
        );

        // Map Issue Type to label using configured mappings
        if (issueType && issueTypeConfig.labelMappings) {
          const label = issueTypeConfig.labelMappings[issueType];
          if (label) {
            labelsToAdd.push(label);
          }
        }
      }

      // Check if documentation was modified (if PR exists)
      if (prNumber) {
        interface GitHubFile {
          filename: string;
        }
        try {
          const files: GitHubFile[] = await this.githubAPI.getPullRequestFiles(prNumber);

          // Check if any .md files or docs folders were modified
          const hasDocChanges = files.some(file =>
            file.filename.endsWith('.md') ||
            file.filename.includes('/docs/') ||
            file.filename.includes('README')
          );

          if (hasDocChanges && !labelsToAdd.includes('documentation')) {
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
   * Update project fields and labels after evaluation
   */
  private async updateProjectFieldsAfterEvaluation(evaluations: IssueEvaluation[]): Promise<void> {
    if (!this.projectsAPI || !this.fieldMapper || !this.githubAPI) return;

    const config = this.configManager.getConfig();

    console.log(chalk.blue('  📝 Updating project fields and labels for evaluated issues...'));

    for (const evaluation of evaluations) {
      try {
        const issueNumber = evaluation.issueNumber;

        // Get project item ID for this issue
        const projectMetadata = await this.fieldMapper.getMetadataForIssues([issueNumber]);
        const metadata = projectMetadata.get(issueNumber);
        const itemId = metadata?.projectItemId;

        if (!itemId) {
          if (this.verbose) {
            console.log(chalk.gray(`    #${issueNumber}: Not in project, skipping field updates`));
          }
          continue;
        }

        // Update status to "Evaluated"
        const statusField = config.project?.fields.status;
        if (statusField) {
          await this.projectsAPI.updateItemStatusByValue(
            itemId,
            statusField.evaluatedValue
          );
        }

        // Update Effort field if configured (converts to hours)
        if (evaluation.estimatedEffort) {
          await this.projectsAPI.syncEffortField(issueNumber, evaluation.estimatedEffort);
        }

        // Update Complexity custom field (instead of label)
        const complexityField = config.project?.fields.complexity;
        const complexity = evaluation.classification.complexity;
        if (complexityField && complexity) {
          // Capitalize first letter for custom field value
          const complexityValue = complexity.charAt(0).toUpperCase() + complexity.slice(1);
          await this.projectsAPI.updateItemFieldValue(
            itemId,
            complexityField.fieldName,
            complexityValue
          );
        }

        // Update Impact custom field (instead of label)
        const impactField = config.project?.fields.impact;
        const impact = evaluation.classification.impact;
        if (impactField && impact) {
          // Capitalize first letter for custom field value
          const impactValue = impact.charAt(0).toUpperCase() + impact.slice(1);
          await this.projectsAPI.updateItemFieldValue(
            itemId,
            impactField.fieldName,
            impactValue
          );
        }

        // Update Priority field from AI suggestion
        const priorityField = config.project?.fields.priority;
        const priority = evaluation.classification.priority;
        if (priorityField && priority) {
          try {
            await this.projectsAPI.updateItemFieldValue(
              itemId,
              priorityField.fieldName,
              priority
            );
          } catch (error) {
            // Priority value might not exist in project options
            if (this.verbose) {
              console.log(chalk.gray(`    ⚠️  Could not set priority "${priority}"`));
            }
          }
        }

        // Update Area field from AI suggestion
        const area = evaluation.classification.area;
        if (area) {
          try {
            await this.projectsAPI.updateItemFieldValue(itemId, 'Area', area);
          } catch (error) {
            // Area value might not exist in project options
            if (this.verbose) {
              console.log(chalk.gray(`    ⚠️  Could not set area "${area}"`));
            }
          }
        }

        // Update Work Type field from AI suggestion
        const workTypeField = config.project?.fields.issueType;
        const workType = evaluation.classification.workType;
        if (workTypeField && workType) {
          try {
            await this.projectsAPI.updateItemFieldValue(
              itemId,
              workTypeField.fieldName,
              workType
            );
          } catch (error) {
            // Work Type value might not exist in project options
            if (this.verbose) {
              console.log(chalk.gray(`    ⚠️  Could not set work type "${workType}"`));
            }
          }
        }

        if (this.verbose) {
          const updatedFields = ['status', 'effort'];
          if (complexity) updatedFields.push('complexity');
          if (impact) updatedFields.push('impact');
          if (priority) updatedFields.push('priority');
          if (area) updatedFields.push('area');
          if (workType) updatedFields.push('workType');
          console.log(chalk.gray(`    ✓ #${issueNumber}: Updated ${updatedFields.join(', ')}`));
        }
      } catch (error) {
        if (this.verbose) {
          console.log(chalk.yellow(`    ⚠️  #${evaluation.issueNumber}: Could not update fields - ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    }
  }
}