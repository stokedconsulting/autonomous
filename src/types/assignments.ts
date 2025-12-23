/**
 * Assignment tracking types for in-memory assignment management
 *
 * ARCHITECTURE CHANGE:
 * - Assignments are stored in-memory only (no JSON file persistence)
 * - GitHub Projects is the source of truth
 * - Assignment data is derived from GitHub Projects on startup
 * - Process state (PIDs, worktrees) is ephemeral and tracked in-memory
 */

export type AssignmentStatus =
  | 'assigned'       // Issue assigned to LLM
  | 'in-progress'    // LLM actively working
  | 'in-review'      // PR created, awaiting review
  | 'dev-complete'   // Dev work done, awaiting merge worker
  | 'merge-review'   // Merge worker reviewing changes
  | 'stage-ready'    // Merged to stage, ready for main
  | 'merged';        // Merged to main, fully complete

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
  processId?: number; // PID of the running LLM process
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

  // Merge & Review (LOCAL - merge worker state)
  mergeStageCommit?: string; // Commit SHA on merge_stage branch
  reviewResults?: {
    startedAt: string;
    completedAt?: string;
    personaReviews: Array<{
      persona: string;
      passed: boolean;
      feedback: string;
      reviewedAt: string;
    }>;
    overallPassed: boolean;
    failureReasons?: string[]; // If failed, why it was sent back to Todo
  };

  // Metadata (LOCAL - process configuration)
  // NOTE: labels removed - read from project instead
  metadata?: {
    requiresTests: boolean;
    requiresCI: boolean;
    estimatedComplexity?: 'low' | 'medium' | 'high';
    isPhaseMaster?: boolean; // True if this is a phase master coordinating sub-items
  };
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
  processId?: number; // PID of the running LLM process
  prNumber?: number;
  prUrl?: string;
  ciStatus?: 'pending' | 'success' | 'failure' | null;
  lastActivity?: string;
  llmInstanceId?: string; // Allow updating instance ID for slot-based naming
  completedAt?: string;
}

// Make all WorkSession fields optional for input (startedAt will be set to current time if not provided)
export type AddWorkSessionInput = Partial<WorkSession>;
