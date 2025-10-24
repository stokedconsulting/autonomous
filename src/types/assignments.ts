/**
 * Assignment tracking types for autonomous-assignments.json
 *
 * SYNC STRATEGY:
 * - Local fields: Process state, timestamps, worktree info (source of truth here)
 * - Synced fields: Status (read from project, written back on changes)
 * - Project fields: Priority, labels, sprint (read from project, never cached here)
 */

export type AssignmentStatus = 'assigned' | 'in-progress' | 'llm-complete' | 'merged';

export type LLMProvider = 'claude' | 'gemini' | 'codex';

export interface WorkSession {
  startedAt: string;
  endedAt?: string;
  summary?: string;
  promptUsed?: string;
}

export interface Assignment {
  // Identity & Linking
  id: string;
  issueNumber: number;
  issueTitle: string;
  issueBody?: string;
  projectItemId?: string;  // NEW: Link to GitHub Projects v2 item (enables sync)

  // Process State (LOCAL - autonomous-specific)
  llmProvider: LLMProvider;
  llmInstanceId: string;
  worktreePath: string;
  branchName: string;
  workSessions: WorkSession[];

  // Status (SYNCED - read from project, written back on state changes)
  status: AssignmentStatus;  // Synced with project Status field

  // Timestamps (LOCAL - detailed lifecycle tracking)
  assignedAt: string;
  startedAt?: string;
  lastActivity?: string;
  completedAt?: string;
  mergedAt?: string;

  // PR & CI (LOCAL - build/deployment state)
  prNumber?: number;
  prUrl?: string;
  ciStatus?: 'pending' | 'success' | 'failure' | null;

  // Metadata (LOCAL - process configuration)
  // NOTE: labels removed - read from project instead
  metadata?: {
    requiresTests: boolean;
    requiresCI: boolean;
    estimatedComplexity?: 'low' | 'medium' | 'high';
  };
}

export interface AssignmentsFile {
  version: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  assignments: Assignment[];
}

export interface CreateAssignmentInput {
  issueNumber: number;
  issueTitle: string;
  issueBody?: string;
  llmProvider: LLMProvider;
  worktreePath: string;
  branchName: string;
  requiresTests?: boolean;
  requiresCI?: boolean;
  // NOTE: labels removed - read from GitHub/project instead
}

export interface UpdateAssignmentInput {
  status?: AssignmentStatus;
  prNumber?: number;
  prUrl?: string;
  ciStatus?: 'pending' | 'success' | 'failure' | null;
  lastActivity?: string;
  llmInstanceId?: string; // Allow updating instance ID for slot-based naming
}

export interface AddWorkSessionInput {
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  promptUsed?: string;
}
