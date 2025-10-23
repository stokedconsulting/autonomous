/**
 * Assignment tracking types for autonomous-assignments.json
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
  id: string;
  issueNumber: number;
  issueTitle: string;
  issueBody?: string;
  llmProvider: LLMProvider;
  llmInstanceId: string;
  status: AssignmentStatus;
  worktreePath: string;
  branchName: string;
  assignedAt: string;
  startedAt?: string;
  lastActivity?: string;
  prNumber?: number;
  prUrl?: string;
  ciStatus?: 'pending' | 'success' | 'failure' | null;
  completedAt?: string;
  mergedAt?: string;
  workSessions: WorkSession[];
  metadata?: {
    requiresTests: boolean;
    requiresCI: boolean;
    labels: string[];
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
  labels?: string[];
}

export interface UpdateAssignmentInput {
  status?: AssignmentStatus;
  prNumber?: number;
  prUrl?: string;
  ciStatus?: 'pending' | 'success' | 'failure' | null;
  lastActivity?: string;
}

export interface AddWorkSessionInput {
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  promptUsed?: string;
}
