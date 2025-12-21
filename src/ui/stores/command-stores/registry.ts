/**
 * Store Registry
 *
 * Tracks active command stores for debugging and memory leak prevention.
 * This registry ensures stores are properly cleaned up when components unmount.
 */

import type { CommandStoreInstance, StoreRegistry } from './types.js';

/**
 * Internal store for tracking active command store instances
 */
const activeStores = new Map<string, CommandStoreInstance>();

/**
 * Store registry for tracking and managing active command stores
 */
export const storeRegistry: StoreRegistry = {
  /**
   * Register a store instance with a unique ID
   */
  register(id: string, instance: CommandStoreInstance): void {
    if (activeStores.has(id)) {
      console.warn(
        `[CommandStore] Store with ID "${id}" already exists. ` +
          'This may indicate a memory leak or duplicate store creation.'
      );
    }
    activeStores.set(id, instance);
  },

  /**
   * Unregister a store instance by ID
   */
  unregister(id: string): void {
    const instance = activeStores.get(id);
    if (instance && !instance.isDestroyed()) {
      instance.destroy();
    }
    activeStores.delete(id);
  },

  /**
   * Get all active store IDs
   */
  getActiveStoreIds(): string[] {
    return Array.from(activeStores.keys());
  },

  /**
   * Get the count of active stores
   */
  getActiveStoreCount(): number {
    return activeStores.size;
  },

  /**
   * Clear all stores (for testing/cleanup)
   */
  clearAll(): void {
    for (const [, instance] of activeStores) {
      if (!instance.isDestroyed()) {
        instance.destroy();
      }
    }
    activeStores.clear();
  },
};

/**
 * Generate a unique store ID
 */
export function generateStoreId(prefix = 'cmd'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Check if a store exists and is active
 */
export function isStoreActive(id: string): boolean {
  const instance = activeStores.get(id);
  return instance !== undefined && !instance.isDestroyed();
}

/**
 * Get a store instance by ID (internal use)
 * @internal
 */
export function getStoreInstance(id: string): CommandStoreInstance | undefined {
  return activeStores.get(id);
}

export default storeRegistry;
