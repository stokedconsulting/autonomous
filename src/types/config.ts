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

export interface AutonomousConfig {
  version: string;
  llms: Record<LLMProvider, LLMConfig>;
  github: GitHubConfig;
  worktree: WorktreeConfig;
  requirements: RequirementsConfig;
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
