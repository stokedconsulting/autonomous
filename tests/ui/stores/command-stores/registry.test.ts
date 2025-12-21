/**
 * Tests for the store registry
 *
 * These tests verify the registry tracks stores correctly and helps prevent memory leaks.
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import {
  storeRegistry,
  generateStoreId,
  isStoreActive,
  createCommandStore,
} from '../../../../src/ui/stores/command-stores';

describe('storeRegistry', () => {
  // Clean up after each test
  afterEach(() => {
    storeRegistry.clearAll();
  });

  describe('registration', () => {
    it('should register stores when created', () => {
      const initialCount = storeRegistry.getActiveStoreCount();

      createCommandStore();
      createCommandStore();

      expect(storeRegistry.getActiveStoreCount()).toBe(initialCount + 2);
    });

    it('should track store IDs', () => {
      createCommandStore();
      const ids = storeRegistry.getActiveStoreIds();

      expect(ids.length).toBeGreaterThan(0);
      expect(ids[0]).toMatch(/^cmd-\d+-[a-z0-9]+$/);
    });

    it('should unregister stores when destroyed', () => {
      const store = createCommandStore();
      const initialCount = storeRegistry.getActiveStoreCount();

      store.destroy();

      expect(storeRegistry.getActiveStoreCount()).toBe(initialCount - 1);
    });
  });

  describe('clearAll', () => {
    it('should destroy all stores', () => {
      const store1 = createCommandStore();
      const store2 = createCommandStore();

      storeRegistry.clearAll();

      expect(storeRegistry.getActiveStoreCount()).toBe(0);
      expect(store1.isDestroyed()).toBe(true);
      expect(store2.isDestroyed()).toBe(true);
    });
  });
});

describe('generateStoreId', () => {
  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateStoreId());
    }

    expect(ids.size).toBe(100);
  });

  it('should use provided prefix', () => {
    const id = generateStoreId('test');
    expect(id).toMatch(/^test-\d+-[a-z0-9]+$/);
  });

  it('should use default prefix', () => {
    const id = generateStoreId();
    expect(id).toMatch(/^cmd-\d+-[a-z0-9]+$/);
  });
});

describe('isStoreActive', () => {
  afterEach(() => {
    storeRegistry.clearAll();
  });

  it('should return false for non-existent store', () => {
    expect(isStoreActive('non-existent-id')).toBe(false);
  });

  it('should return true for active store', () => {
    createCommandStore();
    const ids = storeRegistry.getActiveStoreIds();

    expect(isStoreActive(ids[0])).toBe(true);
  });

  it('should return false after store is destroyed', () => {
    const store = createCommandStore();
    const ids = storeRegistry.getActiveStoreIds();
    const id = ids[ids.length - 1];

    store.destroy();

    expect(isStoreActive(id)).toBe(false);
  });
});
