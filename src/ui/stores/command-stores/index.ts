/**
 * Command Stores Module
 *
 * Provides command-local Zustand stores with lifecycle management.
 *
 * Features:
 * - Factory function for creating command stores
 * - Automatic cleanup on component unmount
 * - Built-in loading states, step progress, and results
 * - Memory leak prevention via store registry
 * - TypeScript enforcement of store interfaces
 *
 * @example
 * ```tsx
 * import {
 *   useCommandStore,
 *   useCommandStoreState,
 *   useStepCommandStore,
 * } from '../stores/command-stores';
 *
 * // Simple usage with full state
 * function MyCommand() {
 *   const store = useCommandStore<MyResult>();
 *   const state = useCommandStoreState(store);
 *   // ... use state and store.getState() for actions
 * }
 *
 * // Step-based command with helpers
 * function SetupWizard() {
 *   const {
 *     steps,
 *     currentStep,
 *     isComplete,
 *     completeCurrentStep,
 *   } = useStepCommandStore<SetupResult>({
 *     initialSteps: [
 *       { id: 'config', label: 'Configure', status: 'active' },
 *       { id: 'install', label: 'Install', status: 'pending' },
 *     ],
 *   });
 *   // ... render step UI
 * }
 * ```
 */

// Core factory
export { createCommandStore, default } from './createCommandStore.js';

// React hooks
export {
  useCommandStore,
  useCommandStoreState,
  useCommandStoreSelector,
  useCommandStoreWithState,
  useStepCommandStore,
} from './useCommandStore.js';

// Registry utilities
export {
  storeRegistry,
  generateStoreId,
  isStoreActive,
} from './registry.js';

// Types
export type {
  // State types
  LoadingState,
  Step,
  BaseCommandState,
  StepProgressState,
  ResultState,
  CommandStoreState,
  CommandStore,

  // Action types
  BaseCommandActions,
  StepProgressActions,
  ResultActions,
  CommandStoreActions,

  // Configuration types
  CreateCommandStoreOptions,
  CommandStoreInstance,
  StoreRegistry,
} from './types.js';
