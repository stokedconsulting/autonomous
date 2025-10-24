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
  customConfig?: Record<string, any>;
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  token?: string;
  labels?: string[];
  excludeLabels?: string[];
  assignToSelf?: boolean;
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
      readyValues: string[]; // Status values considered "ready" (e.g., ["Ready", "Todo"])
      inProgressValue: string; // Status for active work (e.g., "In Progress")
      reviewValue: string; // Status for PR review (e.g., "In Review")
      doneValue: string; // Status for completed work (e.g., "Done")
      blockedValue: string; // Status for blocked work (e.g., "Blocked")
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

export interface AutonomousConfig {
  version: string;
  llms: Record<LLMProvider, LLMConfig>;
  github: GitHubConfig;
  worktree: WorktreeConfig;
  requirements: RequirementsConfig;
  project?: ProjectConfig; // Phase 0+ GitHub Projects v2 integration
  push?: PushConfig;
  notifications?: NotificationConfig;
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
