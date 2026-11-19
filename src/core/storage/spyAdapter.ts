/**
 * core/storage/spyAdapter.ts — memory adapter that COUNTS operations.
 * Used by performance tests to assert storage-write budgets.
 */
import type { StorageAdapter } from './StorageAdapter';

export interface MemoryAdapterSpy {
  adapter: StorageAdapter;
  readonly setCalls: number;
  readonly getCalls: number;
  readonly bag: Map<string, unknown>;
}

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
