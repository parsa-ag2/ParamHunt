/**
 * core/storage/chromeStorageAdapter.ts — chrome.storage.local backend.
 *
 * Design notes:
 *  - chrome.storage.local (MV3): 10 MB default quota, survives SW suspension,
 *    shares across contexts — this is the authoritative store for findings.
 *  - chrome.storage.sync is for tiny user prefs only (options sync), NEVER
 *    findings (quota ~100KB). IndexedDB migration planned for large sets.
 * TODO(M0): implement get/set/remove/keys on top of chrome.storage.local.
 */
import type { StorageAdapter } from './StorageAdapter';
import { STORAGE_KEYS } from '@shared/constants';

export function createChromeStorageAdapter(): StorageAdapter {
  return {
    get: async (key) => {
      const bag = await chrome.storage.local.get(key);
      return bag[key] as never;
    },
    set: async (key, value) => {
      await chrome.storage.local.set({ [key]: value });
    },
    remove: async (key) => {
      await chrome.storage.local.remove(key);
    },
    keys: async (prefix) => {
      const all = await chrome.storage.local.get(null);
      return Object.keys(all).filter((k) => !prefix || k.startsWith(prefix));
    },
  };
}

export { STORAGE_KEYS };
