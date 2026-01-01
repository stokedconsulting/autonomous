/**
 * ProjectStartApp - Interactive Ink UI for starting autonomous project work
 *
 * Features:
 * - Displays full issue titles (not truncated)
 * - Parallel evaluation of multiple issues
 * - Interactive navigation (arrow keys, Enter for details, Escape to return)
 * - Real-time progress tracking
 *
 * Usage: auto project start <identifier> [--no-ui] [--verbose]
 * Ink UI is enabled by default when the terminal is interactive.
 */

import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';
import { CommandUI, useCommandUI } from '../components/CommandUI.js';
import { ConfigManager } from '../../core/config-manager.js';
import { ProjectConfig } from '../../types/config.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { GitHubAPI } from '../../github/api.js';
import { GitHubProjectsAPI, ProjectItem } from '../../github/projects-api.js';
import { ProjectDiscovery, DiscoveredProject } from '../../github/project-discovery.js';
import { getGitHubToken } from '../../utils/github-token.js';
import { WorktreeManager } from '../../git/worktree-manager.js';
import { LLMAdapter } from '../../llm/adapter.js';
import { LLMFactory } from '../../llm/llm-factory.js';
import { PromptBuilder } from '../../llm/prompt-builder.js';
import { InstanceManager } from '../../core/instance-manager.js';
import { detectSessionCompletion, extractPRNumber, detectAutonomousSignals } from '../../utils/session-analyzer.js';
import { resolveLLMProvider } from '../../utils/llm-provider.js';
import { LLMProvider } from '../../types/assignments.js';
import { basename, join } from 'path';
import { promises as fs } from 'fs';
import { getLatestFailedReviewFeedback } from '../../utils/review-feedback.js';

export interface ProjectStartAppProps {
  projectIdentifier: string;
  verbose?: boolean;
  maxParallel?: number;  // Max concurrent evaluations (default: 1)
  dryRun?: boolean;
  provider?: string;
}

interface WorkItem {
  issueNumber: number;
  title: string;
  body?: string;
  status: 'pending' | 'evaluating' | 'working' | 'completed' | 'failed' | 'blocked';
  progress?: string;
  prNumber?: number;
  errorMessage?: string;
  projectItemId?: string;
  projectStatus?: string;
}

interface IssueDetails {
  number: number;
  title: string;
  body: string;
  labels: string[];
  comments: Array<{
    author: string;
    body: string;
    createdAt: string;
  }>;
}

type ViewMode = 'list' | 'details';
type AppPhase = 'loading' | 'ready' | 'working' | 'complete' | 'error';

/**
 * Memoized work item row component to prevent re-rendering unchanged items
 */
interface WorkItemRowProps {
  item: WorkItem;
  isSelected: boolean;
  showSpinner: boolean;
}

const WorkItemRow = memo(function WorkItemRow({ item, isSelected, showSpinner }: WorkItemRowProps) {
  let statusIcon: string;
  let statusColor: string;

  switch (item.status) {
    case 'completed':
      statusIcon = '✓';
      statusColor = 'green';
      break;
    case 'failed':
      statusIcon = '✗';
      statusColor = 'red';
      break;
    case 'blocked':
      statusIcon = '⚠';
      statusColor = 'yellow';
      break;
    case 'working':
    case 'evaluating':
      statusIcon = '◎';
      statusColor = 'cyan';
      break;
    default:
      statusIcon = '○';
      statusColor = 'gray';
  }

  return (
    <Box gap={1}>
      <Text color={isSelected ? 'white' : 'gray'}>
        {isSelected ? '▸' : ' '}
      </Text>
      <Text color={statusColor}>{statusIcon}</Text>
      <Text color="yellow">#{item.issueNumber}</Text>
      <Text
        color={isSelected ? 'white' : undefined}
        bold={isSelected}
        wrap="truncate"
      >
        {item.title}
      </Text>
      {(item.status === 'working' || item.status === 'evaluating') && (
        <>
          {showSpinner && <Spinner />}
          {item.progress && <Text dimColor>{item.progress}</Text>}
        </>
      )}
      {item.prNumber && (
        <Text color="green">PR #{item.prNumber}</Text>
      )}
      {item.errorMessage && (
        <Text color="red">({item.errorMessage})</Text>
      )}
    </Box>
  );
});

export function ProjectStartApp({
  projectIdentifier,
  verbose = false,
  maxParallel = 1,
  dryRun = false,
  provider,
}: ProjectStartAppProps): React.ReactElement {
  const { exit, isInteractive, isQuietMode } = useCommandUI();

  // State
  const [phase, setPhase] = useState<AppPhase>('loading');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [project, setProject] = useState<DiscoveredProject | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedDetails, setSelectedDetails] = useState<IssueDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [worktreePath, setWorktreePath] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);

  // Services (stored in refs to avoid re-creation)
  const [services, setServices] = useState<{
    githubAPI: GitHubAPI;
    projectsAPI: GitHubProjectsAPI;
    assignmentManager: AssignmentManager;
    instanceManager: InstanceManager;
    llmAdapter: LLMAdapter;
    llmProvider: LLMProvider;
    configManager: ConfigManager;
  } | null>(null);

  // Throttled item updates to reduce flickering
  // Store pending updates in a ref and flush periodically
  const pendingUpdates = useRef<Map<number, Partial<WorkItem>>>(new Map());
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const UPDATE_THROTTLE_MS = 250; // Update UI at most every 250ms

  const flushItemUpdates = useCallback(() => {
    if (pendingUpdates.current.size === 0) return;

    const updates = new Map(pendingUpdates.current);
    pendingUpdates.current.clear();

    setItems(prev => prev.map(item => {
      const update = updates.get(item.issueNumber);
      if (update) {
        return { ...item, ...update };
      }
      return item;
    }));
  }, []);

  const updateItem = useCallback((issueNumber: number, update: Partial<WorkItem>) => {
    // Merge with any existing pending update for this item
    const existing = pendingUpdates.current.get(issueNumber) || {};
    pendingUpdates.current.set(issueNumber, { ...existing, ...update });

    // Schedule a flush if not already scheduled
    if (!updateTimerRef.current) {
      updateTimerRef.current = setTimeout(() => {
        updateTimerRef.current = null;
        flushItemUpdates();
      }, UPDATE_THROTTLE_MS);
    }
  }, [flushItemUpdates]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

  // Computed stats
  const stats = useMemo(() => {
    const completed = items.filter(i => i.status === 'completed').length;
    const failed = items.filter(i => i.status === 'failed').length;
    const blocked = items.filter(i => i.status === 'blocked').length;
    const working = items.filter(i => i.status === 'working' || i.status === 'evaluating').length;
    const pending = items.filter(i => i.status === 'pending').length;
    return { completed, failed, blocked, working, pending, total: items.length };
  }, [items]);

  // Keyboard handling
  useInput((input, key) => {
    // In details view
    if (viewMode === 'details') {
      if (key.escape || input === 'q') {
        setViewMode('list');
        setSelectedDetails(null);
        return;
      }
      return; // Don't process other keys in details view
    }

    // In list view
    if (phase === 'ready' || phase === 'working' || phase === 'complete' || phase === 'error') {
      // Navigation
      if (key.upArrow || input === 'k') {
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
        return;
      }

      // View details
      if (key.return || input === 'v') {
        if (items[selectedIndex]) {
          viewItemDetails(items[selectedIndex]);
        }
        return;
      }

      // Start work (only in ready phase)
      if (phase === 'ready' && (input === 's' || input === ' ')) {
        startWork();
        return;
      }

      // Quit
      if (input === 'q' && (phase === 'complete' || phase === 'error')) {
        exit();
        return;
      }
    }
  }, { isActive: isInteractive });

  // View issue details
  const viewItemDetails = useCallback(async (item: WorkItem) => {
    if (!services) return;

    setViewMode('details');
    try {
      const issue = await services.githubAPI.getIssue(item.issueNumber);
      const comments = await services.githubAPI.getComments(item.issueNumber);

      setSelectedDetails({
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        labels: issue.labels.map((l: any) => typeof l === 'string' ? l : l.name),
        comments: comments.slice(-10).map((c: any) => ({
          author: c.user?.login || 'unknown',
          body: c.body || '',
          createdAt: c.created_at,
        })),
      });
    } catch (err) {
      setSelectedDetails({
        number: item.issueNumber,
        title: item.title,
        body: 'Failed to load details',
        labels: [],
        comments: [],
      });
    }
  }, [services]);

  // Initialize and load project
  useEffect(() => {
    async function initialize() {
      try {
        const cwd = process.cwd();
        const projectName = basename(cwd);

        // Load configuration
        const configManager = new ConfigManager(cwd);
        await configManager.initialize();
        const config = configManager.getConfig();

        // Get GitHub token
        const githubToken = await getGitHubToken(config.github.token);
        if (!githubToken) {
          throw new Error('GitHub token not found');
        }

        // Find the project
        const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
        const projects = await discovery.getLinkedProjects();

        if (projects.length === 0) {
          throw new Error('No projects linked to this repository');
        }

        // Match by number or title
        let matchedProject: DiscoveredProject | undefined;
        const searchTerm = projectIdentifier.toLowerCase();
        const projectNumber = parseInt(projectIdentifier);

        if (!isNaN(projectNumber)) {
          matchedProject = projects.find(p => p.number === projectNumber);
        }
        if (!matchedProject) {
          matchedProject = projects.find(p =>
            p.title.toLowerCase() === searchTerm ||
            p.title.toLowerCase().includes(searchTerm)
          );
        }

        if (!matchedProject) {
          throw new Error(`No project found matching "${projectIdentifier}"`);
        }

        setProject(matchedProject);

        // Initialize APIs
        const githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);
        const projectsAPI = new GitHubProjectsAPI(matchedProject.id, config.project as ProjectConfig);

        // Initialize assignment manager
        const assignmentManager = new AssignmentManager(cwd, {
          projectAPI: projectsAPI,
        });
        await assignmentManager.initialize(projectName, cwd);

        // Initialize instance manager
        const maxSlots = {
          claude: config.llms.claude.maxConcurrentIssues,
          gemini: config.llms.gemini.maxConcurrentIssues,
          codex: config.llms.codex.maxConcurrentIssues,
        };
        const instanceManager = new InstanceManager(assignmentManager, maxSlots);

        // Select provider and initialize adapter
        const autonomousDataDir = join(cwd, '.autonomous');
        await fs.mkdir(autonomousDataDir, { recursive: true });
        const llmProvider = resolveLLMProvider(config, provider);
        const llmAdapter = LLMFactory.create([llmProvider], config.llms, autonomousDataDir, verbose);

        // Get items ready for work
        const statusFieldName = config.project?.fields?.status?.fieldName;
        const readyStatuses = Array.from(
          new Set([
            ...(config.project?.fields?.status?.readyValues || ['Todo', 'Ready', 'Evaluated']),
            'Failed Review',
          ])
        );
        const projectItems = await projectsAPI.getAllItems({
          status: readyStatuses,
        });

        // Filter out Phase Masters and already assigned items
        const workItems = projectItems.filter(i =>
          !PromptBuilder.isPhaseMaster(i.content.title) &&
          !assignmentManager.isIssueAssigned(i.content.number)
        );

        // Convert to WorkItems
        const workItemsList: WorkItem[] = workItems.map((item: ProjectItem) => ({
          issueNumber: item.content.number,
          title: item.content.title,
          status: 'pending' as const,
          projectItemId: item.id,
          projectStatus: statusFieldName ? item.fieldValues?.[statusFieldName] : undefined,
        }));

        setItems(workItemsList);

        // Set up worktree path
        const projectSlug = matchedProject.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 40);
        const branch = `project/${matchedProject.number}-${projectSlug}`;
        const worktree = join(
          cwd,
          config.worktree.baseDir || '..',
          `${projectName}-project-${matchedProject.number}`
        );

        setBranchName(branch);
        setWorktreePath(worktree);

        // Store services
        setServices({
          githubAPI,
          projectsAPI,
          assignmentManager,
          instanceManager,
          llmAdapter,
          llmProvider,
          configManager,
        });

        setPhase('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    }

    initialize();
  }, [projectIdentifier, verbose, provider]);

  // Start autonomous work
  const startWork = useCallback(async () => {
    if (!services || !worktreePath || !branchName || dryRun) {
      if (dryRun) {
        setPhase('complete');
      }
      return;
    }

    setPhase('working');

    const { githubAPI, projectsAPI, assignmentManager, instanceManager, llmAdapter, llmProvider, configManager } = services;
    const config = configManager.getConfig();
    const cwd = process.cwd();
    const projectName = basename(cwd);
    const statusFieldName = config.project?.fields?.status?.fieldName;

    // Ensure worktree exists
    const worktreeManager = new WorktreeManager(cwd);
    try {
      await fs.access(worktreePath);
    } catch {
      // Create worktree
      const defaultBranch = await worktreeManager.getDefaultBranch();
      await worktreeManager.createWorktree({
        issueNumber: project!.number,
        branchName,
        baseDir: config.worktree.baseDir || '..',
        projectName,
        baseBranch: defaultBranch,
        customPath: worktreePath,
      });
    }

    // Process items (cap at maxParallel)
    const pendingItems = items.filter(i => i.status === 'pending');
    const processingQueue = [...pendingItems];
    const activeWorkers: Promise<void>[] = [];

    const processItem = async (item: WorkItem) => {
      // Update status to evaluating (throttled)
      updateItem(item.issueNumber, { status: 'evaluating' as const, progress: 'Starting...' });

      try {
        // Refresh status to capture late transitions back to Failed Review
        let projectStatus = item.projectStatus;
        if (statusFieldName && item.projectItemId) {
          try {
            const latestStatus = await projectsAPI.getItemFieldValue(item.projectItemId, statusFieldName);
            projectStatus = (latestStatus as string) || projectStatus;
          } catch {
            // Ignore status fetch failures in UI flow
          }
        }

        // Get issue details
        const issue = await githubAPI.getIssue(item.issueNumber);

        let failedReviewFeedback: Awaited<ReturnType<typeof getLatestFailedReviewFeedback>> = null;
        if (projectStatus === 'Failed Review') {
          try {
            failedReviewFeedback = await getLatestFailedReviewFeedback(githubAPI, item.issueNumber);
          } catch {
            // Keep running even if review feedback cannot be fetched
          }
        }

        // Get available slot
        const slot = instanceManager.getNextAvailableSlot(llmProvider);
        if (!slot) {
          throw new Error(`No available ${llmProvider} slots`);
        }

        // Create assignment
        const assignment = await assignmentManager.createAssignment({
          issueNumber: item.issueNumber,
          issueTitle: issue.title,
          issueBody: issue.body || undefined,
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

        await assignmentManager.updateAssignment(assignment.id, {
          llmInstanceId: slot.instanceId,
        });
        assignment.llmInstanceId = slot.instanceId;

        // Link to project
        await assignmentManager.ensureProjectItemId(assignment.id);
        await assignmentManager.updateAssignedInstanceWithSync(assignment.id, slot.instanceId);

        // Update status to working (throttled)
        updateItem(item.issueNumber, { status: 'working' as const, progress: 'Working...' });

        // Generate prompt and start LLM
        const prompt = PromptBuilder.buildInitialPrompt({
          assignment,
          worktreePath,
        });

        await llmAdapter.start({
          assignment,
          prompt,
          workingDirectory: worktreePath,
        });

        await assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');

        // Monitor for completion
        const autonomousDataDir = join(cwd, '.autonomous');
        const logPath = join(autonomousDataDir, 'logs', `output-${slot.instanceId}.log`);

        // Poll for completion
        let completed = false;
        while (!completed) {
          await new Promise(resolve => setTimeout(resolve, 3000));

          const status = await llmAdapter.getStatus(slot.instanceId);
          const signals = detectAutonomousSignals(logPath);
          const sessionAnalysis = detectSessionCompletion(logPath);
          const prNumber = extractPRNumber(logPath);
          const allowHeuristicCompletion = llmAdapter.provider !== 'codex';
          const shouldAnalyze = !status.isRunning || (!llmAdapter.supportsHooks() && signals.hasSignal);

          if (!shouldAnalyze) {
            continue;
          }

          try {
            await llmAdapter.stop(slot.instanceId);
          } catch {
            // Ignore stop failures for already-exited processes
          }

          if (signals.isComplete || (allowHeuristicCompletion && sessionAnalysis.isComplete)) {
            // Success!
            completed = true;
            updateItem(item.issueNumber, {
              status: 'completed' as const,
              prNumber: signals.prNumber || prNumber,
              progress: undefined,
            });
            flushItemUpdates(); // Immediate update for completion

            await assignmentManager.updateAssignment(assignment.id, {
              status: 'dev-complete',
              completedAt: new Date().toISOString(),
            });

            if (item.projectItemId) {
              await projectsAPI.updateItemStatusByValue(item.projectItemId, 'Dev Complete');
              await assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
            }
          } else if (signals.isBlocked) {
            // Blocked
            completed = true;
            updateItem(item.issueNumber, {
              status: 'blocked' as const,
              errorMessage: signals.blockedReason,
              progress: undefined,
            });
            flushItemUpdates(); // Immediate update for terminal state
          } else if (signals.isFailed) {
            // Failed
            completed = true;
            updateItem(item.issueNumber, {
              status: 'failed' as const,
              errorMessage: signals.failedReason,
              progress: undefined,
            });
            flushItemUpdates(); // Immediate update for terminal state
          } else {
            // Process exited without completion - try to resurrect once
            updateItem(item.issueNumber, { progress: 'Resuming...' });

            try {
              const continuePrompt = PromptBuilder.buildContinuationPrompt({
                assignment,
                worktreePath,
              });

              await llmAdapter.start({
                assignment,
                prompt: continuePrompt,
                workingDirectory: worktreePath,
              });
            } catch {
              // Give up
              completed = true;
              updateItem(item.issueNumber, {
                status: 'failed' as const,
                errorMessage: 'Process exited without completion',
                progress: undefined,
              });
              flushItemUpdates(); // Immediate update for terminal state
            }
          }
        }
      } catch (err) {
        updateItem(item.issueNumber, {
          status: 'failed' as const,
          errorMessage: err instanceof Error ? err.message : String(err),
          progress: undefined,
        });
        flushItemUpdates(); // Immediate update for terminal state
      }
    };

    // Worker function
    const startWorker = async () => {
      while (processingQueue.length > 0) {
        const item = processingQueue.shift();
        if (item) {
          await processItem(item);
        }
      }
    };

    // Start parallel workers
    for (let i = 0; i < Math.min(maxParallel, processingQueue.length); i++) {
      activeWorkers.push(startWorker());
    }

    // Wait for all workers to complete
    await Promise.all(activeWorkers);

    // Final flush to ensure all updates are rendered
    flushItemUpdates();
    setPhase('complete');
  }, [services, worktreePath, branchName, items, project, maxParallel, dryRun, updateItem, flushItemUpdates]);

  const headerMeta = project || dryRun ? (
    <Box gap={2}>
      {project && (
        <Text>{project.title} (#{project.number})</Text>
      )}
      {dryRun && <Text color="yellow">[DRY RUN]</Text>}
    </Box>
  ) : null;

  const keyboardHints = useMemo(() => {
    if (!isInteractive || phase === 'loading') {
      return [];
    }
    if (viewMode === 'details') {
      return [
        { keys: 'Esc/q', label: 'back' },
      ];
    }
    const hints = [
      { keys: '↑/↓', label: 'navigate' },
      { keys: 'Enter', label: 'details' },
    ];
    if (phase === 'ready' && items.length > 0) {
      hints.push({ keys: 's/Space', label: 'start' });
    }
    if (phase === 'complete' || phase === 'error') {
      hints.push({ keys: 'q', label: 'quit' });
    }
    return hints;
  }, [isInteractive, items.length, phase, viewMode]);

  const showSpinner = isInteractive;
  let content: React.ReactElement;

  if (isQuietMode) {
    content = <></>;
  } else if (phase === 'loading') {
    content = (
      <Box flexDirection="column">
        <Box gap={1}>
          {isInteractive ? (
            <Spinner label={`Loading project "${projectIdentifier}"...`} />
          ) : (
            <Text>Loading project "{projectIdentifier}"...</Text>
          )}
        </Box>
      </Box>
    );
  } else if (phase === 'error') {
    content = (
      <Box flexDirection="column">
        <Text color="red" bold>✗ Error</Text>
        <Text color="red">{error}</Text>
        {isInteractive && (
          <Box marginTop={1}>
            <Text dimColor>Press q to exit</Text>
          </Box>
        )}
      </Box>
    );
  } else if (viewMode === 'details' && selectedDetails) {
    content = (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
          <Text bold color="cyan">Issue #{selectedDetails.number}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text bold wrap="wrap">{selectedDetails.title}</Text>
        </Box>

        {selectedDetails.labels.length > 0 && (
          <Box marginBottom={1} gap={1}>
            {selectedDetails.labels.map(label => (
              <Text key={label} color="yellow">[{label}]</Text>
            ))}
          </Box>
        )}

        <Box marginBottom={1} flexDirection="column">
          <Text color="blue" bold>Description:</Text>
          <Text wrap="wrap" dimColor>
            {selectedDetails.body.substring(0, 500) || '(No description)'}
            {selectedDetails.body.length > 500 ? '...' : ''}
          </Text>
        </Box>

        {selectedDetails.comments.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="blue" bold>Recent Comments ({selectedDetails.comments.length}):</Text>
            {selectedDetails.comments.slice(-3).map((comment, idx) => (
              <Box key={idx} marginTop={1} flexDirection="column">
                <Text color="cyan">@{comment.author} - {new Date(comment.createdAt).toLocaleDateString()}</Text>
                <Text wrap="wrap" dimColor>
                  {comment.body.substring(0, 200)}
                  {comment.body.length > 200 ? '...' : ''}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {isInteractive && (
          <Box marginTop={2}>
            <Text dimColor>Press Escape or q to return to list</Text>
          </Box>
        )}
      </Box>
    );
  } else {
    content = (
      <Box flexDirection="column">
        {/* Summary Bar */}
        <Box gap={3} marginBottom={1}>
          <Text>Total: {stats.total}</Text>
          {stats.working > 0 && <Text color="cyan">⚡ Working: {stats.working}</Text>}
          {stats.completed > 0 && <Text color="green">✓ Completed: {stats.completed}</Text>}
          {stats.failed > 0 && <Text color="red">✗ Failed: {stats.failed}</Text>}
          {stats.blocked > 0 && <Text color="yellow">⚠ Blocked: {stats.blocked}</Text>}
          {stats.pending > 0 && phase !== 'complete' && (
            <Text dimColor>Pending: {stats.pending}</Text>
          )}
        </Box>

        {/* Worktree info */}
        {worktreePath && (
          <Box marginBottom={1}>
            <Text dimColor>Worktree: {worktreePath}</Text>
          </Box>
        )}

        {/* Items List */}
        {items.length === 0 ? (
          <Box padding={1}>
            <Text dimColor>No items ready for work. All caught up! 🎉</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {items.map((item, index) => (
              <WorkItemRow
                key={item.issueNumber}
                item={item}
                isSelected={index === selectedIndex}
                showSpinner={showSpinner}
              />
            ))}
          </Box>
        )}

        {/* Footer / Help */}
        <Box marginTop={1} flexDirection="column">
          {isInteractive && phase === 'ready' && items.length > 0 && (
            <Box borderStyle="round" borderColor="green" paddingX={1}>
              <Text color="green">
                Press [s] or [space] to start work on {Math.min(maxParallel, items.length)} item{Math.min(maxParallel, items.length) === 1 ? '' : 's'} in parallel
              </Text>
            </Box>
          )}

          {phase === 'complete' && (
            <Box borderStyle="round" borderColor="green" paddingX={1}>
              <Text color="green" bold>
                ✓ Complete! {stats.completed} completed, {stats.failed} failed
                {stats.blocked > 0 && `, ${stats.blocked} blocked`}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <CommandUI commandName="🚀 Project Start" headerMeta={headerMeta} keyboardHints={keyboardHints}>
      {content}
    </CommandUI>
  );
}
