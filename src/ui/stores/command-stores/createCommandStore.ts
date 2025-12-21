/**
 * createCommandStore - Factory function for command-local Zustand stores
 *
 * Creates Zustand stores that are scoped to command lifecycle, supporting
 * common patterns like loading states, step progress, and results.
 *
 * Features:
 * - Automatic cleanup on destroy
 * - Built-in loading state management
 * - Step progress tracking
 * - Result storage
 * - Memory leak prevention via registry
 *
 * @example
 * ```typescript
 * // Create a store for a setup command
 * const setupStore = createCommandStore<SetupResult>({
 *   initialSteps: [
 *     { id: 'config', label: 'Configure', status: 'pending' },
 *     { id: 'install', label: 'Install', status: 'pending' },
 *     { id: 'verify', label: 'Verify', status: 'pending' },
 *   ],
 * });
 *
 * // Use in component
 * const { loadingState, steps, setLoadingState, completeCurrentStep } = setupStore.getState();
 *
 * // Cleanup when done
 * setupStore.destroy();
 * ```
 */

import { createStore } from 'zustand/vanilla';
import type {
  CommandStore,
  CommandStoreInstance,
  CommandStoreState,
  CreateCommandStoreOptions,
  Step,
} from './types.js';
import { storeRegistry, generateStoreId } from './registry.js';

/**
 * Default initial state for command stores
 */
function getInitialState<TResult>(
  options: CreateCommandStoreOptions<TResult>
): CommandStoreState<TResult> {
  return {
    // Base state
    loadingState: 'idle',
    error: null,
    progress: null,

    // Step progress state
    steps: options.initialSteps ?? [],
    currentStepIndex: 0,

    // Result state
    result: options.initialResult ?? null,
  };
}

/**
 * Create the actions for the command store
 */
function createActions<TResult>(
  set: (
    partial:
      | Partial<CommandStore<TResult>>
      | ((state: CommandStore<TResult>) => Partial<CommandStore<TResult>>)
  ) => void,
  get: () => CommandStore<TResult>,
  initialState: CommandStoreState<TResult>
) {
  return {
    // Base actions
    setLoadingState: (loadingState: CommandStore<TResult>['loadingState']) => {
      set({ loadingState });
    },

    setError: (error: string | null) => {
      set({
        error,
        loadingState: error ? 'error' : get().loadingState,
      });
    },

    setProgress: (progress: number | null) => {
      set({ progress });
    },

    reset: () => {
      set(initialState as Partial<CommandStore<TResult>>);
    },

    // Step progress actions
    setSteps: (steps: Step[]) => {
      set({ steps, currentStepIndex: 0 });
    },

    goToStep: (index: number) => {
      const { steps } = get();
      if (index >= 0 && index < steps.length) {
        const updatedSteps = steps.map((step, i) => {
          if (i === index) {
            return { ...step, status: 'active' as const };
          }
          if (i < index && step.status !== 'skipped' && step.status !== 'error') {
            return { ...step, status: 'completed' as const };
          }
          return step;
        });
        set({ steps: updatedSteps, currentStepIndex: index });
      }
    },

    completeCurrentStep: () => {
      const { steps, currentStepIndex } = get();
      if (currentStepIndex < steps.length) {
        const updatedSteps = steps.map((step, i) => {
          if (i === currentStepIndex) {
            return { ...step, status: 'completed' as const };
          }
          if (i === currentStepIndex + 1) {
            return { ...step, status: 'active' as const };
          }
          return step;
        });
        set({
          steps: updatedSteps,
          currentStepIndex: Math.min(currentStepIndex + 1, steps.length - 1),
        });
      }
    },

    setStepError: (stepId: string, error: string) => {
      const { steps } = get();
      const updatedSteps = steps.map((step) =>
        step.id === stepId ? { ...step, status: 'error' as const, error } : step
      );
      set({ steps: updatedSteps, loadingState: 'error', error });
    },

    skipStep: (stepId: string) => {
      const { steps, currentStepIndex } = get();
      const stepIndex = steps.findIndex((s) => s.id === stepId);
      const updatedSteps = steps.map((step, i) => {
        if (step.id === stepId) {
          return { ...step, status: 'skipped' as const };
        }
        // If skipping current step, activate the next one
        if (stepIndex === currentStepIndex && i === currentStepIndex + 1) {
          return { ...step, status: 'active' as const };
        }
        return step;
      });

      const newIndex =
        stepIndex === currentStepIndex
          ? Math.min(currentStepIndex + 1, steps.length - 1)
          : currentStepIndex;

      set({ steps: updatedSteps, currentStepIndex: newIndex });
    },

    getCurrentStep: () => {
      const { steps, currentStepIndex } = get();
      return steps[currentStepIndex];
    },

    // Result actions
    setResult: (result: TResult | null) => {
      set({ result, loadingState: result !== null ? 'success' : get().loadingState });
    },
  };
}

/**
 * Create a command-local Zustand store
 *
 * The store is automatically registered for tracking and can be destroyed
 * to cleanup resources and prevent memory leaks.
 *
 * @param options - Configuration options for the store
 * @returns A store instance with lifecycle management
 */
export function createCommandStore<TResult = unknown>(
  options: CreateCommandStoreOptions<TResult> = {}
): CommandStoreInstance<TResult> {
  const storeId = generateStoreId();
  let destroyed = false;

  const initialState = getInitialState<TResult>(options);

  const store = createStore<CommandStore<TResult>>((set, get) => ({
    ...initialState,
    ...createActions<TResult>(set, get, initialState),
  }));

  const instance: CommandStoreInstance<TResult> = {
    store,

    getState: () => {
      if (destroyed) {
        throw new Error(
          `[CommandStore] Cannot access state of destroyed store "${storeId}"`
        );
      }
      return store.getState();
    },

    subscribe: (listener) => {
      if (destroyed) {
        throw new Error(
          `[CommandStore] Cannot subscribe to destroyed store "${storeId}"`
        );
      }
      return store.subscribe(listener);
    },

    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;

      // Call cleanup callback if provided
      options.onDestroy?.();

      // Unregister from registry
      storeRegistry.unregister(storeId);

      // Reset store state to allow garbage collection
      store.setState(initialState as CommandStore<TResult>);
    },

    isDestroyed: () => destroyed,
  };

  // Register the store instance
  storeRegistry.register(storeId, instance as CommandStoreInstance);

  return instance;
}

export default createCommandStore;
