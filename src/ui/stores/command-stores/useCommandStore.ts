/**
 * useCommandStore - React hooks for command store lifecycle management
 *
 * These hooks ensure stores are created and destroyed with component lifecycle,
 * preventing memory leaks from orphaned stores.
 *
 * @example
 * ```tsx
 * function SetupCommand() {
 *   const store = useCommandStore<SetupResult>({
 *     initialSteps: [
 *       { id: 'config', label: 'Configure', status: 'pending' },
 *       { id: 'install', label: 'Install', status: 'pending' },
 *     ],
 *   });
 *
 *   const { loadingState, steps, currentStepIndex, setLoadingState } = useStore(store.store);
 *
 *   // Store is automatically cleaned up when component unmounts
 *   return <StepProgress steps={steps} currentIndex={currentStepIndex} />;
 * }
 * ```
 */

import { useEffect, useRef, useMemo, useSyncExternalStore, useCallback } from 'react';
import type {
  CommandStore,
  CommandStoreInstance,
  CreateCommandStoreOptions,
} from './types.js';
import { createCommandStore } from './createCommandStore.js';

/**
 * Hook to create and manage a command store with automatic lifecycle management
 *
 * Creates a store on mount and destroys it on unmount, ensuring no memory leaks.
 *
 * @param options - Configuration options for the store
 * @returns The store instance with lifecycle management
 */
export function useCommandStore<TResult = unknown>(
  options: CreateCommandStoreOptions<TResult> = {}
): CommandStoreInstance<TResult> {
  // Use a ref to track if we've created the store
  const storeRef = useRef<CommandStoreInstance<TResult> | null>(null);

  // Create the store lazily on first access (for React 18 Strict Mode compatibility)
  if (storeRef.current === null) {
    storeRef.current = createCommandStore<TResult>(options);
  }

  // Cleanup on unmount
  useEffect(() => {
    const store = storeRef.current;
    return () => {
      if (store && !store.isDestroyed()) {
        store.destroy();
      }
    };
  }, []);

  return storeRef.current;
}

/**
 * Hook to subscribe to a command store and re-render on state changes
 *
 * This hook uses useSyncExternalStore for optimal React 18 compatibility.
 *
 * @param storeInstance - The command store instance
 * @returns The current store state
 */
export function useCommandStoreState<TResult = unknown>(
  storeInstance: CommandStoreInstance<TResult>
): CommandStore<TResult> {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return storeInstance.subscribe(onStoreChange);
    },
    [storeInstance]
  );

  const getSnapshot = useCallback(() => {
    return storeInstance.getState();
  }, [storeInstance]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Hook to select specific state from a command store
 *
 * Uses a selector for optimal re-render performance.
 *
 * @param storeInstance - The command store instance
 * @param selector - Function to select specific state
 * @returns The selected state
 */
export function useCommandStoreSelector<TResult = unknown, TSelected = unknown>(
  storeInstance: CommandStoreInstance<TResult>,
  selector: (state: CommandStore<TResult>) => TSelected
): TSelected {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return storeInstance.subscribe(onStoreChange);
    },
    [storeInstance]
  );

  const getSnapshot = useCallback(() => {
    return selector(storeInstance.getState());
  }, [storeInstance, selector]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Combined hook that creates a store and returns both instance and state
 *
 * Convenience hook for components that need both store actions and reactive state.
 *
 * @param options - Configuration options for the store
 * @returns Tuple of [store instance, current state]
 *
 * @example
 * ```tsx
 * function MyCommand() {
 *   const [store, state] = useCommandStoreWithState<MyResult>();
 *
 *   const handleStart = () => {
 *     store.getState().setLoadingState('loading');
 *   };
 *
 *   return (
 *     <Box>
 *       <Text>Status: {state.loadingState}</Text>
 *       <Button onPress={handleStart}>Start</Button>
 *     </Box>
 *   );
 * }
 * ```
 */
export function useCommandStoreWithState<TResult = unknown>(
  options: CreateCommandStoreOptions<TResult> = {}
): [CommandStoreInstance<TResult>, CommandStore<TResult>] {
  const store = useCommandStore<TResult>(options);
  const state = useCommandStoreState<TResult>(store);
  return [store, state];
}

/**
 * Hook for step-based commands with convenience accessors
 *
 * Provides commonly used step-related state and actions.
 *
 * @param options - Configuration options for the store
 * @returns Object with step-related state and actions
 *
 * @example
 * ```tsx
 * function SetupWizard() {
 *   const {
 *     steps,
 *     currentStep,
 *     isComplete,
 *     progress,
 *     completeCurrentStep,
 *     goToStep,
 *   } = useStepCommandStore<SetupResult>({
 *     initialSteps: [
 *       { id: 'welcome', label: 'Welcome', status: 'active' },
 *       { id: 'config', label: 'Configure', status: 'pending' },
 *       { id: 'done', label: 'Complete', status: 'pending' },
 *     ],
 *   });
 *
 *   return (
 *     <StepIndicator steps={steps} current={currentStep} />
 *   );
 * }
 * ```
 */
export function useStepCommandStore<TResult = unknown>(
  options: CreateCommandStoreOptions<TResult> = {}
) {
  const [store, state] = useCommandStoreWithState<TResult>(options);

  // Memoize derived state
  const stepHelpers = useMemo(() => {
    const { steps, currentStepIndex } = state;
    const currentStep = steps[currentStepIndex];
    const isComplete = steps.length > 0 && steps.every(
      (s) => s.status === 'completed' || s.status === 'skipped'
    );
    const hasError = steps.some((s) => s.status === 'error');
    const completedCount = steps.filter((s) => s.status === 'completed').length;
    const totalSteps = steps.length;
    const progressPercent = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

    return {
      currentStep,
      isComplete,
      hasError,
      completedCount,
      totalSteps,
      progressPercent,
    };
  }, [state]);

  // Memoize action accessors
  const actions = useMemo(() => {
    const storeState = store.getState();
    return {
      completeCurrentStep: storeState.completeCurrentStep,
      goToStep: storeState.goToStep,
      setStepError: storeState.setStepError,
      skipStep: storeState.skipStep,
      setSteps: storeState.setSteps,
      setResult: storeState.setResult,
      setLoadingState: storeState.setLoadingState,
      setError: storeState.setError,
      reset: storeState.reset,
    };
  }, [store]);

  return {
    // Store instance for advanced usage
    store,

    // State
    steps: state.steps,
    currentStepIndex: state.currentStepIndex,
    loadingState: state.loadingState,
    error: state.error,
    result: state.result,

    // Derived state
    ...stepHelpers,

    // Actions
    ...actions,
  };
}

export default useCommandStore;
