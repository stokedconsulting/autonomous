/**
 * ProjectReviewApp - Standalone Ink application for reviewing project items
 *
 * Usage: auto project review <identifier> [--all] [--multi]
 *
 * Features:
 * - Parallel review processing
 * - Interactive navigation (arrow keys, Enter for details, Escape to return)
 * - Real-time progress tracking with URLs
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';
import { ConfigManager } from '../../core/config-manager.js';
import { ProjectConfig } from '../../types/config.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { ReviewWorker } from '../../core/review-worker.js';
import { GitHubAPI } from '../../github/api.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { ProjectFieldMapper } from '../../github/project-field-mapper.js';
import { ProjectDiscovery, DiscoveredProject } from '../../github/project-discovery.js';
import { getGitHubToken } from '../../utils/github-token.js';
import { WorktreeManager, WorktreeInfo } from '../../git/worktree-manager.js';
import { basename } from 'path';

export interface ProjectReviewAppProps {
  projectIdentifier: string;
  allItems?: boolean;      // --all flag: review ALL items, not just "In Review"
  multiPersona?: boolean;  // --multi flag: use all personas, not just architect
  verbose?: boolean;
  maxParallel?: number;    // Max concurrent reviews (default: 3)
}

interface ReviewItem {
  issueNumber: number;
  title: string;
  status: 'pending' | 'reviewing' | 'passed' | 'failed' | 'error';
  errorMessage?: string;
  issueUrl?: string;     // Base issue URL (always available)
  commentUrl?: string;   // Full comment URL (only after review)
  branch?: string;       // Branch being reviewed
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
type AppPhase = 'loading' | 'ready' | 'reviewing' | 'complete' | 'error';

/**
 * Extract meaningful title from issue, removing project prefix
 * Handles patterns like "[Project Name] Phase 1.1: Actual Title" -> "Phase 1.1: Actual Title"
 */
function extractMeaningfulTitle(fullTitle: string): string {
  // Remove leading [Project Name] prefix if present
  const bracketMatch = fullTitle.match(/^\[[^\]]+\]\s*(.+)$/);
  if (bracketMatch) {
    return bracketMatch[1];
  }

  // Remove leading "Project Name - " prefix if present
  const dashMatch = fullTitle.match(/^[^-]+-\s*(.+)$/);
  if (dashMatch && dashMatch[1].length > 10) {
    return dashMatch[1];
  }

  return fullTitle;
}

export function ProjectReviewApp({
  projectIdentifier,
  allItems = false,
  multiPersona = false,
  verbose = false,
  maxParallel = 3,
}: ProjectReviewAppProps): React.ReactElement {
  const { exit } = useApp();

  // State
  const [phase, setPhase] = useState<AppPhase>('loading');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [project, setProject] = useState<DiscoveredProject | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedDetails, setSelectedDetails] = useState<IssueDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewWorker, setReviewWorker] = useState<ReviewWorker | null>(null);
  const [projectWorktree, setProjectWorktree] = useState<WorktreeInfo | null>(null);
  const [activeWorkers, setActiveWorkers] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [githubAPI, setGithubAPI] = useState<GitHubAPI | null>(null);

  // View issue details
  const viewItemDetails = useCallback(async (item: ReviewItem) => {
    if (!githubAPI) return;

    setViewMode('details');
    try {
      const issue = await githubAPI.getIssue(item.issueNumber);
      const comments = await githubAPI.getComments(item.issueNumber);

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
  }, [githubAPI]);

  // Keyboard handling (only when running in a TTY)
  useInput((input, key) => {
    // Global exit
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

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
    if (phase === 'reviewing' || phase === 'complete' || phase === 'error') {
      // Navigation
      if (key.upArrow || input === 'k') {
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
        return;
      }
      // Jump to first/last
      if (input === 'g') {
        setSelectedIndex(0);
        return;
      }
      if (input === 'G') {
        setSelectedIndex(items.length - 1);
        return;
      }

      // View details
      if (key.return || input === 'v') {
        if (items[selectedIndex]) {
          viewItemDetails(items[selectedIndex]);
        }
        return;
      }

      // Quit
      if (input === 'q' && (phase === 'complete' || phase === 'error')) {
        exit();
        return;
      }
    }
  }, { isActive: process.stdin.isTTY === true });

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
        const api = new GitHubAPI(githubToken, config.github.owner, config.github.repo);
        const projectsAPI = new GitHubProjectsAPI(matchedProject.id, config.project as ProjectConfig);
        const fieldMapper = new ProjectFieldMapper(projectsAPI, config.project as ProjectConfig);

        // Store GitHub API for later use (viewing details)
        setGithubAPI(api);

        // Construct base URL for issues
        const baseIssueUrl = `https://github.com/${config.github.owner}/${config.github.repo}/issues`;

        // Get items to review
        const targetStatuses = allItems
          ? undefined  // All items
          : ['In Review'];  // Only "In Review" items

        const projectItems = await projectsAPI.getAllItems(
          targetStatuses ? { status: targetStatuses } : undefined
        );

        if (projectItems.length === 0) {
          setItems([]);
          setPhase('complete');
          return;
        }

        // Convert to ReviewItems with issue URLs
        const reviewItems: ReviewItem[] = projectItems.map(item => ({
          issueNumber: item.content.number,
          title: item.content.title,
          status: 'pending' as const,
          issueUrl: `${baseIssueUrl}/${item.content.number}`,
        }));

        setItems(reviewItems);

        // Initialize ReviewWorker
        const assignmentManager = new AssignmentManager(cwd);
        await assignmentManager.initialize(projectName, cwd);

        const claudePath = config.reviewWorker?.claudePath || config.llms?.claude?.cliPath || 'claude';
        const worker = new ReviewWorker(cwd, assignmentManager, api, claudePath, 1, fieldMapper);

        // Note: Don't call worker.setPersonas() - pass personas in options instead
        // The --multi flag controls which personas run via the personas option

        // Find the project worktree (pattern: project/N-... where N is project number)
        const worktreeManager = new WorktreeManager(cwd);
        const allWorktrees = await worktreeManager.listWorktrees();

        // Look for worktree matching project/N- pattern
        const projWorktree = allWorktrees.find(w => {
          const branch = w.branch || '';
          return branch.startsWith(`project/${matchedProject.number}-`) ||
                 branch === `project/${matchedProject.number}`;
        });

        if (projWorktree) {
          setProjectWorktree(projWorktree);
        }

        setReviewWorker(worker);
        setPhase('ready');

      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    }

    initialize();
  }, [projectIdentifier, allItems, multiPersona]);

  // Process a single item (used by parallel workers)
  const processItem = useCallback(async (itemIndex: number) => {
    if (!reviewWorker || !projectWorktree) return;

    const item = items[itemIndex];

    // Update status to reviewing
    setItems(prev => prev.map((it, idx) =>
      idx === itemIndex ? { ...it, status: 'reviewing' as const, branch: projectWorktree.branch } : it
    ));

    try {
      const result = await reviewWorker.reviewByIssueNumber(item.issueNumber, {
        passStatus: 'Dev Complete',
        failStatus: 'Failed Review',
        verbose,
        branch: projectWorktree.branch,
        personas: multiPersona ? undefined : ['architect'],
      });

      if (result) {
        setItems(prev => prev.map((it, idx) =>
          idx === itemIndex ? {
            ...it,
            status: result.passed ? 'passed' as const : 'failed' as const,
            commentUrl: result.commentUrl,
          } : it
        ));
      } else {
        setItems(prev => prev.map((it, idx) =>
          idx === itemIndex ? { ...it, status: 'error' as const, errorMessage: 'Review returned null' } : it
        ));
      }
    } catch (err) {
      setItems(prev => prev.map((it, idx) =>
        idx === itemIndex ? {
          ...it,
          status: 'error' as const,
          errorMessage: err instanceof Error ? err.message : String(err),
        } : it
      ));
    }

    setCompletedCount(prev => prev + 1);
  }, [reviewWorker, items, verbose, multiPersona, projectWorktree]);

  // Start reviewing when ready - parallel processing
  const startReviewing = useCallback(async () => {
    if (!reviewWorker || items.length === 0) return;

    if (!projectWorktree) {
      setError('No project worktree found');
      setPhase('error');
      return;
    }

    setPhase('reviewing');

    // Create a queue of indices to process
    const queue: number[] = items.map((_, idx) => idx);
    let nextIndex = 0;

    // Worker function that pulls from queue
    const worker = async () => {
      while (nextIndex < queue.length) {
        const idx = nextIndex++;
        setActiveWorkers(prev => prev + 1);
        await processItem(queue[idx]);
        setActiveWorkers(prev => prev - 1);
      }
    };

    // Start parallel workers
    const workerCount = Math.min(maxParallel, items.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }

    // Wait for all workers to complete
    await Promise.all(workers);

    setPhase('complete');
  }, [reviewWorker, items, maxParallel, projectWorktree, processItem]);

  // Auto-start when ready (requires project worktree to be found)
  useEffect(() => {
    if (phase === 'ready' && items.length > 0) {
      if (!projectWorktree) {
        setError('No project worktree found. Create a worktree with branch pattern: project/N-name');
        setPhase('error');
        return;
      }
      startReviewing();
    }
  }, [phase, items.length, projectWorktree, startReviewing]);

  // Calculate summary stats
  const passedCount = items.filter(i => i.status === 'passed').length;
  const failedCount = items.filter(i => i.status === 'failed').length;
  const errorCount = items.filter(i => i.status === 'error').length;
  const pendingCount = items.filter(i => i.status === 'pending' || i.status === 'reviewing').length;

  // Render based on phase
  if (phase === 'loading') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box gap={1}>
          <Spinner label={`Loading project "${projectIdentifier}"...`} />
        </Box>
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>✗ Error</Text>
        <Text color="red">{error}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press q to exit</Text>
        </Box>
      </Box>
    );
  }

  // Details view
  if (viewMode === 'details' && selectedDetails) {
    return (
      <Box flexDirection="column" padding={1}>
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
            {selectedDetails.body.substring(0, 800) || '(No description)'}
            {selectedDetails.body.length > 800 ? '...' : ''}
          </Text>
        </Box>

        {selectedDetails.comments.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="blue" bold>Recent Comments ({selectedDetails.comments.length}):</Text>
            {selectedDetails.comments.slice(-5).map((comment, idx) => (
              <Box key={idx} marginTop={1} flexDirection="column">
                <Text color="cyan">@{comment.author} - {new Date(comment.createdAt).toLocaleDateString()}</Text>
                <Text wrap="wrap" dimColor>
                  {comment.body.substring(0, 300)}
                  {comment.body.length > 300 ? '...' : ''}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={2}>
          <Text dimColor>Press Escape or q to return to list</Text>
        </Box>
      </Box>
    );
  }

  // List view
  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="round" borderColor="blue" paddingX={1} marginBottom={1}>
        <Box gap={2}>
          <Text bold color="blue">🔍 Project Review</Text>
          {project && (
            <Text>{project.title} (#{project.number})</Text>
          )}
          {allItems && <Text color="yellow">[ALL]</Text>}
          {multiPersona && <Text color="cyan">[MULTI]</Text>}
        </Box>
      </Box>

      {/* Summary Bar */}
      <Box gap={3} marginBottom={1}>
        <Text>Total: {items.length}</Text>
        {phase === 'reviewing' && (
          <>
            <Text color="cyan">Active: {activeWorkers}/{maxParallel}</Text>
            <Text color="blue">Done: {completedCount}/{items.length}</Text>
          </>
        )}
        {passedCount > 0 && <Text color="green">✓ Passed: {passedCount}</Text>}
        {failedCount > 0 && <Text color="red">✗ Failed: {failedCount}</Text>}
        {errorCount > 0 && <Text color="yellow">⚠ Errors: {errorCount}</Text>}
        {pendingCount > 0 && phase !== 'complete' && (
          <Text dimColor>Pending: {pendingCount}</Text>
        )}
      </Box>

      {/* Items List */}
      {items.length === 0 ? (
        <Box padding={1}>
          <Text dimColor>No items to review. All caught up! 🎉</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {items.map((item, index) => {
            const isSelected = index === selectedIndex;
            const isActive = item.status === 'reviewing';

            let statusIcon: string;
            let statusColor: string;

            switch (item.status) {
              case 'passed':
                statusIcon = '✓';
                statusColor = 'green';
                break;
              case 'failed':
                statusIcon = '✗';
                statusColor = 'red';
                break;
              case 'error':
                statusIcon = '⚠';
                statusColor = 'yellow';
                break;
              case 'reviewing':
                statusIcon = '◎';
                statusColor = 'cyan';
                break;
              default:
                statusIcon = '○';
                statusColor = 'gray';
            }

            // Determine which URL to show: commentUrl if review is done, otherwise issueUrl
            const displayUrl = item.commentUrl || item.issueUrl;

            return (
              <Box key={item.issueNumber} gap={1}>
                <Text color={isSelected ? 'white' : 'gray'}>
                  {isSelected ? '▸' : ' '}
                </Text>
                <Text color={statusColor}>{statusIcon}</Text>
                <Text color="yellow">#{item.issueNumber}</Text>
                <Text color={isSelected ? 'white' : isActive ? 'cyan' : undefined} bold={isSelected}>
                  {(() => {
                    const meaningful = extractMeaningfulTitle(item.title);
                    return meaningful.length > 40 ? meaningful.substring(0, 40) + '...' : meaningful;
                  })()}
                </Text>
                {item.branch && (
                  <Text dimColor>[{item.branch}]</Text>
                )}
                {item.status === 'reviewing' && <Spinner />}
                {displayUrl && (
                  <Text dimColor>→ {displayUrl}</Text>
                )}
                {item.errorMessage && (
                  <Text color="yellow">({item.errorMessage})</Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Footer */}
      {phase === 'complete' && (
        <Box marginTop={1} flexDirection="column">
          <Box borderStyle="round" borderColor="green" paddingX={1}>
            <Text color="green" bold>
              ✓ Review complete! {passedCount} passed, {failedCount} failed
              {errorCount > 0 && `, ${errorCount} errors`}
            </Text>
          </Box>
        </Box>
      )}

      {/* Keyboard hints */}
      <Box marginTop={1} gap={2}>
        <Text dimColor>↑/↓: Navigate</Text>
        <Text dimColor>Enter: View details</Text>
        <Text dimColor>g/G: First/Last</Text>
        {phase === 'complete' && <Text dimColor>q: Quit</Text>}
      </Box>
    </Box>
  );
}
