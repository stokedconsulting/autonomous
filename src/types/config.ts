/**
 * Configuration types for .autonomous-config.json
 */

import { LLMProvider } from './assignments.js';

export interface LLMConfig {
  enabled: boolean;
  maxConcurrentIssues: number;
  cliPath?: string;
  cliArgs?: string[];
  hooksEnabled?: boolean;
  apiKey?: string;
  model?: string;
  user?: string; // GitHub username to assign issues to when this LLM takes work
  customConfig?: Record<string, any>;
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  token?: string;
  labels?: string[];
  excludeLabels?: string[];
  assignToSelf?: boolean;
  botUsername?: string; // GitHub username to assign autonomous work to (e.g., "claude-bot")
  postClarificationComments?: boolean; // Auto-post AI-generated questions as comments (default: true)
}

export interface WorktreeConfig {
  baseDir: string;
  namingPattern: string;
  branchPrefix?: string;
  cleanup?: {
    onComplete: boolean;
    onError: boolean;
  };
}

export interface RequirementsConfig {
  testingRequired: boolean;
  ciMustPass: boolean;
  prTemplateRequired: boolean;
  minTestCoverage?: number;
  requiresReview?: boolean;
}

export interface NotificationConfig {
  enabled: boolean;
  slack?: {
    webhookUrl: string;
    channel?: string;
  };
  discord?: {
    webhookUrl: string;
  };
  email?: {
    smtp: string;
    from: string;
    to: string[];
  };
}

export interface PushConfig {
  scopeMap?: Record<string, string>; // File pattern -> scope mapping
  enableChangeset?: boolean; // Whether to generate changesets (default true)
  conventionalCommits?: boolean; // Use conventional commits (default true)
}

/**
 * GitHub Projects v2 Configuration (Phase 0+)
 *
 * Enables integration with GitHub Projects for:
 * - Reading project fields (Priority, Status, Size, etc.) fresh on each query
 * - Syncing assignment status back to project
 * - Hybrid prioritization combining AI + project metadata
 */
export interface ProjectConfig {
  enabled: boolean;
  projectNumber: number; // GitHub Projects v2 number
  organizationProject: boolean; // true for org projects, false for user/repo projects

  // Field mapping configuration
  fields: {
    status: {
      fieldName: string; // Usually "Status"
      readyValues: string[]; // Status values considered "ready" (e.g., ["Ready", "Todo", "Evaluated"])
      evaluateValue?: string; // Status that triggers AI evaluation (e.g., "Evaluate") - optional
      inProgressValue: string; // Status for active work (e.g., "In Progress")
      reviewValue: string; // Status for PR review (e.g., "In Review")
      doneValue: string; // Status for completed work (e.g., "Done")
      blockedValue: string; // Status for blocked work (e.g., "Blocked")
      evaluatedValue: string; // Status for evaluated issues (e.g., "Evaluated")
      needsMoreInfoValue: string; // Status for issues needing clarification (e.g., "Needs More Info")
    };
    priority?: {
      fieldName: string; // Usually "Priority"
      values: Record<
        string,
        {
          weight: number; // 1-10 scale for prioritization
        }
      >; // e.g., { "critical": { weight: 10 }, "high": { weight: 7 } }
    };
    size?: {
      fieldName: string; // Usually "Size"
      preferredSizes?: string[]; // Sizes to prefer (e.g., ["S", "M"])
    };
    sprint?: {
      fieldName: string; // Usually "Sprint"
      currentSprint?: string; // Name/ID of current sprint for boost
    };
    assignedInstance?: {
      fieldName: string; // Usually "Assigned Instance" or "LLM Worker"
      // Values are auto-generated as {provider}-{slotNumber}, e.g., "claude-1", "gemini-2"
    };
    issueType?: {
      fieldName: string; // Usually "Issue Type" or "Work Type"
      labelMappings?: Record<string, string>; // Maps issue type values to GitHub labels (e.g., { "Bug": "bug", "Feature": "enhancement" })
    };
    effort?: {
      fieldName: string; // Usually "Effort" or "Estimated Effort"
      // Auto-populated from AI's estimatedEffort field (e.g., "2-4 hours", "1-2 days")
    };
    complexity?: {
      fieldName: string; // Usually "Complexity"
      // Auto-populated from complexity:* labels (e.g., complexity:high -> High)
    };
    impact?: {
      fieldName: string; // Usually "Impact"
      // Auto-populated from impact:* labels (e.g., impact:high -> High)
    };
  };

  // Hybrid prioritization weights (Phase 1+)
  prioritization?: {
    weights: {
      projectPriority: number; // Weight for project Priority field (0.0-1.0)
      aiEvaluation: number; // Weight for AI priority score (0.0-1.0)
      sprintBoost: number; // Weight for current sprint boost (0.0-1.0)
      sizePreference: number; // Weight for size preference (0.0-1.0)
    };
  };

  // Sync configuration
  sync?: {
    conflictResolution: 'project-wins' | 'local-wins'; // Default: 'project-wins'
    autoReconcile: boolean; // Auto-reconcile on startup (default: false)
    syncInterval?: number; // Minutes between background syncs (0 = disabled)
  };
}

export interface MergeWorkerConfig {
  enabled: boolean;
  claudePath?: string;
  mainBranch?: string;
  stageBranch?: string;
  requireAllPersonasPass?: boolean;
  autoResolveConflicts?: boolean;
  personas?: string[]; // Custom persona names to use
}

export interface ReviewWorkerConfig {
  maxConcurrent?: number; // Max concurrent reviews (default: 3)
  claudePath?: string;    // Path to Claude CLI executable (default: 'claude')
}

export interface AutonomousConfig {
  version: string;
  llms: Record<LLMProvider, LLMConfig>;
  github: GitHubConfig;
  worktree: WorktreeConfig;
  requirements: RequirementsConfig;
  project?: ProjectConfig; // Phase 0+ GitHub Projects v2 integration
  push?: PushConfig;
  notifications?: NotificationConfig;
  mergeWorker?: MergeWorkerConfig; // Automated merge and review worker
  reviewWorker?: ReviewWorkerConfig; // Manual review worker configuration
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
  };
}

export interface InitConfigOptions {
  githubOwner?: string;
  githubRepo?: string;
  enabledLLMs?: LLMProvider[];
  interactive?: boolean;
}

export interface AddLLMOptions {
  provider: LLMProvider;
  cliPath?: string;
  apiKey?: string;
  maxConcurrent?: number;
  enableHooks?: boolean;
}
