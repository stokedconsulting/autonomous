/**
 * Base LLM adapter interface
 * All LLM providers must implement this interface
 */

import { Assignment, LLMProvider } from '../types/index.js';

export interface LLMStatus {
  instanceId: string;
  provider: LLMProvider;
  isRunning: boolean;
  currentAssignment?: Assignment;
  startedAt?: string;
  lastActivity?: string;
  processId?: number;
}

export interface StartLLMOptions {
  assignment: Assignment;
  prompt: string;
  workingDirectory: string;
  configPath?: string;
}

export interface LLMAdapter {
  /**
   * Unique identifier for the provider
   */
  readonly provider: LLMProvider;

  /**
   * Start an LLM instance with the given assignment
   */
  start(options: StartLLMOptions): Promise<string>; // Returns instance ID

  /**
   * Stop a running LLM instance
   */
  stop(instanceId: string): Promise<void>;

  /**
   * Get the current status of an LLM instance
   */
  getStatus(instanceId: string): Promise<LLMStatus>;

  /**
   * Check if the provider supports hooks
   */
  supportsHooks(): boolean;

  /**
   * Install hooks for the provider (if supported)
   */
  installHooks?(worktreePath: string, assignmentId: string): Promise<void>;

  /**
   * Send a new prompt to a running instance
   */
  sendPrompt?(instanceId: string, prompt: string): Promise<void>;

  /**
   * Get the work summary from the last session
   */
  getLastSummary?(instanceId: string): Promise<string | null>;

  /**
   * Check if the LLM CLI is installed and accessible
   */
  isInstalled(): Promise<boolean>;

  /**
   * Get the version of the LLM CLI
   */
  getVersion(): Promise<string | null>;
}

/**
 * Factory function type for creating LLM adapters
 */
export type LLMAdapterFactory = (config: any) => LLMAdapter;

/**
 * Registry for LLM adapter factories
 */
export class LLMAdapterRegistry {
  private static adapters = new Map<LLMProvider, LLMAdapterFactory>();

  static register(provider: LLMProvider, factory: LLMAdapterFactory): void {
    this.adapters.set(provider, factory);
  }

  static get(provider: LLMProvider): LLMAdapterFactory | undefined {
    return this.adapters.get(provider);
  }

  static has(provider: LLMProvider): boolean {
    return this.adapters.has(provider);
  }

  static getAll(): LLMProvider[] {
    return Array.from(this.adapters.keys());
  }
}
