/**
 * shared/settings.ts — scope settings load/save (single source of truth).
 *
 * Readers: content scripts (read-only) and the background (authority).
 * Writer: Options page + background (single-writer rule for storage).
 */
import type { ScopeConfig } from './scope';
import { STORAGE_KEYS } from './constants';

export interface ScopeSettings extends ScopeConfig {
  /** Field name reported in messages for UX clarity. */
  mode: 'origin';
  allowlist: string[];
  exclusions: string[];
}

export const DEFAULT_SETTINGS: ScopeSettings = {
  mode: 'origin',
  allowlist: [],
  exclusions: [],
};

export async function loadSettings(): Promise<ScopeSettings> {
  const bag = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = (bag[STORAGE_KEYS.settings] ?? {}) as Partial<ScopeSettings>;
  return {
    mode: 'origin',
    allowlist: Array.isArray(raw.allowlist) ? raw.allowlist.filter((x): x is string => typeof x === 'string') : [],
    exclusions: Array.isArray(raw.exclusions) ? raw.exclusions.filter((x): x is string => typeof x === 'string') : [],
  };
}

export async function saveSettings(settings: ScopeSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}
