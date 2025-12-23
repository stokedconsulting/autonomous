import { Assignment } from '../types/assignments.js';

export interface StartLLMOptions {
  assignment: Assignment;
  prompt: string;
  workingDirectory: string;
}

export interface LLMStatus {
  instanceId: string;
  provider: string;
  isRunning: boolean;
  startedAt?: string;
  lastActivity?: string;
  processId?: number;
}

export interface LLMAdapter {
  readonly provider: string;

  start(options: StartLLMOptions): Promise<string>;
  stop(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<LLMStatus>;
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  supportsHooks(): boolean;
  installHooks(worktreePath: string, assignmentId: string): Promise<void>;
  getLastSummary(instanceId: string): Promise<string | null>;
}