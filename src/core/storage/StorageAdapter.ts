/**
 * core/storage/StorageAdapter.ts — storage port (hexagonal seam).
 *
 * The engine and all modules depend on THIS interface, never on chrome.storage
 * directly. Benefits: unit tests use in-memory fakes; a future backend swap
 * (IndexedDB for large result sets) changes one adapter, zero module changes.
 */
export interface StorageAdapter {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  /** List keys with a prefix (used by results queries + settings pages). */
  keys(prefix?: string): Promise<string[]>;
}
