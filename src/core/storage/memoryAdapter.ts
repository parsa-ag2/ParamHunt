/**
 * core/storage/memoryAdapter.ts — in-memory StorageAdapter for unit tests.
 * Identical semantics to the chrome backend from the store's point of view.
 */
import type { StorageAdapter } from './StorageAdapter';

export function createMemoryAdapter(): StorageAdapter {
  const bag = new Map<string, unknown>();
  return {
    get: async (key) => bag.get(key) as never,
    set: async (key, value) => {
      bag.set(key, value);
    },
    remove: async (key) => {
      bag.delete(key);
    },
    keys: async (prefix) =>
      [...bag.keys()].filter((k) => !prefix || k.startsWith(prefix)),
  };
}
