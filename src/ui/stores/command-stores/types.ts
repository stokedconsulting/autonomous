/**
 * Command Store Types
 *
 * TypeScript interfaces for command-local Zustand stores.
 * These types enforce a consistent interface for all command stores.
 */

import type { StoreApi } from 'zustand';

/**
 * Loading state enum for command operations
 */
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Step definition for multi-step commands
 */
export interface Step {
  /**
   * Unique identifier for the step
   */
  id: string;

  /**
   * Display label for the step
   */
  label: string;

  /**
   * Current status of the step
   */
  status: 'pending' | 'active' | 'completed' | 'skipped' | 'error';

  /**
   * Optional error message if step failed
   */
  error?: string;
}

/**
 * Base state that all command stores must implement
 */
export interface BaseCommandState {
  /**
   * Current loading state of the command
   */
  loadingState: LoadingState;

  /**
   * Error message if loadingState is 'error'
   */
  error: string | null;

  /**
   * Progress percentage (0-100) for operations that support it
   */
  progress: number | null;
}

/**
 * Base actions that all command stores must implement
 */
export interface BaseCommandActions {
  /**
   * Set the loading state
   */
  setLoadingState: (state: LoadingState) => void;

  /**
   * Set an error message (also sets loadingState to 'error')
   */
  setError: (error: string | null) => void;

  /**
   * Set progress percentage
   */
  setProgress: (progress: number | null) => void;

  /**
   * Reset the store to its initial state
   */
  reset: () => void;
}

/**
 * Step progress state for multi-step commands
 */
export interface StepProgressState {
  /**
   * Array of steps in the command
   */
  steps: Step[];

  /**
   * Index of the currently active step
   */
  currentStepIndex: number;
}

/**
 * Step progress actions for multi-step commands
 */
export interface StepProgressActions {
  /**
   * Set the steps for the command
   */
  setSteps: (steps: Step[]) => void;

  /**
   * Move to a specific step by index
   */
  goToStep: (index: number) => void;

  /**
   * Mark the current step as completed and move to next
   */
  completeCurrentStep: () => void;

  /**
   * Mark a step as having an error
   */
  setStepError: (stepId: string, error: string) => void;

  /**
   * Skip a step
   */
  skipStep: (stepId: string) => void;

  /**
   * Get the current step
   */
  getCurrentStep: () => Step | undefined;
}

/**
 * Result state for commands that produce results
 */
export interface ResultState<TResult> {
  /**
   * The result of the command operation
   */
  result: TResult | null;
}

/**
 * Result actions for commands that produce results
 */
export interface ResultActions<TResult> {
  /**
   * Set the result
   */
  setResult: (result: TResult | null) => void;
}

/**
 * Combined command store state with all features
 */
export type CommandStoreState<TResult = unknown> = BaseCommandState &
  StepProgressState &
  ResultState<TResult>;

/**
 * Combined command store actions with all features
 */
export type CommandStoreActions<TResult = unknown> = BaseCommandActions &
  StepProgressActions &
  ResultActions<TResult>;

/**
 * Full command store type (state + actions)
 */
export type CommandStore<TResult = unknown> = CommandStoreState<TResult> &
  CommandStoreActions<TResult>;

/**
 * Configuration options for createCommandStore
 */
export interface CreateCommandStoreOptions<TResult = unknown> {
  /**
   * Initial steps for step-based commands
   */
  initialSteps?: Step[];

  /**
   * Initial result value
   */
  initialResult?: TResult | null;

  /**
   * Called when the store is destroyed (for cleanup)
   */
  onDestroy?: () => void;
}

/**
 * Wrapped store with lifecycle management
 */
export interface CommandStoreInstance<TResult = unknown> {
  /**
   * The Zustand store API
   */
  store: StoreApi<CommandStore<TResult>>;

  /**
   * Get the current state
   */
  getState: () => CommandStore<TResult>;

  /**
   * Subscribe to state changes
   */
  subscribe: StoreApi<CommandStore<TResult>>['subscribe'];

  /**
   * Destroy the store and cleanup resources
   */
  destroy: () => void;

  /**
   * Whether the store has been destroyed
   */
  isDestroyed: () => boolean;
}

/**
 * Registry for tracking active command stores
 * Used for debugging and preventing memory leaks
 */
export interface StoreRegistry {
  /**
   * Register a store instance
   */
  register: (id: string, instance: CommandStoreInstance) => void;

  /**
   * Unregister a store instance
   */
  unregister: (id: string) => void;

  /**
   * Get all active store IDs
   */
  getActiveStoreIds: () => string[];

  /**
   * Get the count of active stores
   */
  getActiveStoreCount: () => number;

  /**
   * Clear all stores (for testing/cleanup)
   */
  clearAll: () => void;
}
