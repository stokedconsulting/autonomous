/**
 * Tests for createCommandStore factory function
 *
 * These tests verify the command store factory creates properly scoped stores
 * with loading states, step progress, and result management.
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import {
  createCommandStore,
  storeRegistry,
  type Step,
  type LoadingState,
} from '../../../../src/ui/stores/command-stores';

describe('createCommandStore', () => {
  // Clean up after each test
  afterEach(() => {
    storeRegistry.clearAll();
  });

  describe('store creation', () => {
    it('should create a store with default initial state', () => {
      const store = createCommandStore();

      const state = store.getState();
      expect(state.loadingState).toBe('idle');
      expect(state.error).toBeNull();
      expect(state.progress).toBeNull();
      expect(state.steps).toEqual([]);
      expect(state.currentStepIndex).toBe(0);
      expect(state.result).toBeNull();
    });

    it('should create a store with initial steps', () => {
      const initialSteps: Step[] = [
        { id: 'step1', label: 'Step 1', status: 'pending' },
        { id: 'step2', label: 'Step 2', status: 'pending' },
      ];

      const store = createCommandStore({ initialSteps });

      expect(store.getState().steps).toEqual(initialSteps);
    });

    it('should create a store with initial result', () => {
      const initialResult = { data: 'test' };
      const store = createCommandStore({ initialResult });

      expect(store.getState().result).toEqual(initialResult);
    });

    it('should register the store in the registry', () => {
      const initialCount = storeRegistry.getActiveStoreCount();
      createCommandStore();

      expect(storeRegistry.getActiveStoreCount()).toBe(initialCount + 1);
    });
  });

  describe('base actions', () => {
    it('should set loading state', () => {
      const store = createCommandStore();

      const states: LoadingState[] = ['idle', 'loading', 'success', 'error'];
      for (const loadingState of states) {
        store.getState().setLoadingState(loadingState);
        expect(store.getState().loadingState).toBe(loadingState);
      }
    });

    it('should set error and update loading state', () => {
      const store = createCommandStore();

      store.getState().setError('Something went wrong');
      expect(store.getState().error).toBe('Something went wrong');
      expect(store.getState().loadingState).toBe('error');
    });

    it('should clear error without changing loading state', () => {
      const store = createCommandStore();
      store.getState().setLoadingState('loading');
      store.getState().setError('Error');
      store.getState().setError(null);

      expect(store.getState().error).toBeNull();
      // Loading state should remain 'error' from when error was set
      expect(store.getState().loadingState).toBe('error');
    });

    it('should set progress', () => {
      const store = createCommandStore();

      store.getState().setProgress(50);
      expect(store.getState().progress).toBe(50);

      store.getState().setProgress(null);
      expect(store.getState().progress).toBeNull();
    });

    it('should reset to initial state', () => {
      const initialSteps: Step[] = [
        { id: 'step1', label: 'Step 1', status: 'pending' },
      ];

      const store = createCommandStore({ initialSteps });

      // Modify state
      store.getState().setLoadingState('loading');
      store.getState().setError('Error');
      store.getState().setProgress(75);

      // Reset
      store.getState().reset();

      const state = store.getState();
      expect(state.loadingState).toBe('idle');
      expect(state.error).toBeNull();
      expect(state.progress).toBeNull();
      expect(state.steps).toEqual(initialSteps);
    });
  });

  describe('step progress actions', () => {
    const initialSteps: Step[] = [
      { id: 'step1', label: 'Step 1', status: 'pending' },
      { id: 'step2', label: 'Step 2', status: 'pending' },
      { id: 'step3', label: 'Step 3', status: 'pending' },
    ];

    it('should set steps', () => {
      const store = createCommandStore();
      const newSteps: Step[] = [
        { id: 'new1', label: 'New 1', status: 'active' },
      ];

      store.getState().setSteps(newSteps);
      expect(store.getState().steps).toEqual(newSteps);
      expect(store.getState().currentStepIndex).toBe(0);
    });

    it('should go to a specific step', () => {
      const store = createCommandStore({ initialSteps });

      store.getState().goToStep(1);

      const state = store.getState();
      expect(state.currentStepIndex).toBe(1);
      expect(state.steps[0].status).toBe('completed');
      expect(state.steps[1].status).toBe('active');
      expect(state.steps[2].status).toBe('pending');
    });

    it('should not go to invalid step index', () => {
      const store = createCommandStore({ initialSteps });

      store.getState().goToStep(-1);
      expect(store.getState().currentStepIndex).toBe(0);

      store.getState().goToStep(10);
      expect(store.getState().currentStepIndex).toBe(0);
    });

    it('should complete current step and move to next', () => {
      const store = createCommandStore({ initialSteps });

      store.getState().goToStep(0); // Set first step as active
      store.getState().completeCurrentStep();

      const state = store.getState();
      expect(state.steps[0].status).toBe('completed');
      expect(state.steps[1].status).toBe('active');
      expect(state.currentStepIndex).toBe(1);
    });

    it('should handle completing the last step', () => {
      const store = createCommandStore({ initialSteps });

      // Go to last step
      store.getState().goToStep(2);
      store.getState().completeCurrentStep();

      const state = store.getState();
      expect(state.steps[2].status).toBe('completed');
      // Should stay at last index
      expect(state.currentStepIndex).toBe(2);
    });

    it('should set step error', () => {
      const store = createCommandStore({ initialSteps });

      store.getState().setStepError('step2', 'Failed to complete');

      const state = store.getState();
      expect(state.steps[1].status).toBe('error');
      expect(state.steps[1].error).toBe('Failed to complete');
      expect(state.loadingState).toBe('error');
      expect(state.error).toBe('Failed to complete');
    });

    it('should skip a step', () => {
      const store = createCommandStore({ initialSteps });

      store.getState().goToStep(0);
      store.getState().skipStep('step1');

      const state = store.getState();
      expect(state.steps[0].status).toBe('skipped');
      expect(state.steps[1].status).toBe('active');
      expect(state.currentStepIndex).toBe(1);
    });

    it('should get current step', () => {
      const store = createCommandStore({ initialSteps });

      store.getState().goToStep(1);
      const current = store.getState().getCurrentStep();

      expect(current?.id).toBe('step2');
    });

    it('should preserve skipped and error status when going to step', () => {
      const steps: Step[] = [
        { id: 'step1', label: 'Step 1', status: 'skipped' },
        { id: 'step2', label: 'Step 2', status: 'error', error: 'Failed' },
        { id: 'step3', label: 'Step 3', status: 'pending' },
      ];

      const store = createCommandStore({ initialSteps: steps });

      store.getState().goToStep(2);

      const state = store.getState();
      expect(state.steps[0].status).toBe('skipped');
      expect(state.steps[1].status).toBe('error');
      expect(state.steps[2].status).toBe('active');
    });
  });

  describe('result actions', () => {
    interface TestResult {
      success: boolean;
      data: string;
    }

    it('should set result', () => {
      const store = createCommandStore<TestResult>();
      const result: TestResult = { success: true, data: 'test data' };

      store.getState().setResult(result);

      expect(store.getState().result).toEqual(result);
      expect(store.getState().loadingState).toBe('success');
    });

    it('should clear result', () => {
      const store = createCommandStore<TestResult>();
      store.getState().setResult({ success: true, data: 'test' });
      store.getState().setResult(null);

      expect(store.getState().result).toBeNull();
    });
  });

  describe('subscription', () => {
    it('should notify subscribers on state change', () => {
      const store = createCommandStore();
      let callCount = 0;

      const unsubscribe = store.subscribe(() => {
        callCount++;
      });

      store.getState().setLoadingState('loading');
      store.getState().setLoadingState('success');

      expect(callCount).toBe(2);

      unsubscribe();

      store.getState().setLoadingState('idle');
      expect(callCount).toBe(2); // Should not increment after unsubscribe
    });
  });

  describe('lifecycle and cleanup', () => {
    it('should mark store as destroyed after destroy()', () => {
      const store = createCommandStore();

      expect(store.isDestroyed()).toBe(false);

      store.destroy();

      expect(store.isDestroyed()).toBe(true);
    });

    it('should throw when accessing destroyed store state', () => {
      const store = createCommandStore();
      store.destroy();

      expect(() => store.getState()).toThrow(/destroyed store/);
    });

    it('should throw when subscribing to destroyed store', () => {
      const store = createCommandStore();
      store.destroy();

      expect(() => store.subscribe(() => {})).toThrow(/destroyed store/);
    });

    it('should call onDestroy callback when destroyed', () => {
      let destroyed = false;
      const store = createCommandStore({
        onDestroy: () => {
          destroyed = true;
        },
      });

      store.destroy();

      expect(destroyed).toBe(true);
    });

    it('should be idempotent when calling destroy multiple times', () => {
      let destroyCount = 0;
      const store = createCommandStore({
        onDestroy: () => {
          destroyCount++;
        },
      });

      store.destroy();
      store.destroy();
      store.destroy();

      expect(destroyCount).toBe(1);
    });

    it('should unregister from registry when destroyed', () => {
      const store = createCommandStore();
      const initialCount = storeRegistry.getActiveStoreCount();

      store.destroy();

      expect(storeRegistry.getActiveStoreCount()).toBe(initialCount - 1);
    });
  });
});
