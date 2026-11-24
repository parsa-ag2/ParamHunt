/**
 * test-utils/storage-adapters.ts — in-memory StorageAdapter doubles for tests.
 * Kept out of the production runtime (imported only by *.test.ts files).
 */
import type { StorageAdapter } from '@core/storage/StorageAdapter';

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
    keys: async (prefix) => [...bag.keys()].filter((k) => !prefix || k.startsWith(prefix)),
  };
}

export interface MemoryAdapterSpy {
  adapter: StorageAdapter;
  readonly setCalls: number;
  readonly getCalls: number;
  readonly bag: Map<string, unknown>;
}

/** Counting variant — asserts storage-write budgets in performance tests. */
export function createMemoryAdapterSpy(): MemoryAdapterSpy {
  const bag = new Map<string, unknown>();
  let setCalls = 0;
  let getCalls = 0;
  const adapter: StorageAdapter = {
    get: async (key) => {
      getCalls += 1;
      return bag.get(key) as never;
    },
    set: async (key, value) => {
      setCalls += 1;
      bag.set(key, value);
    },
    remove: async (key) => {
      bag.delete(key);
    },
    keys: async (prefix) => [...bag.keys()].filter((k) => !prefix || k.startsWith(prefix)),
  };
  return {
    adapter,
    get setCalls() {
      return setCalls;
    },
    get getCalls() {
      return getCalls;
    },
    bag,
  };
}
