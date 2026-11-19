/**
 * shared/settings.ts — settings + discovery configuration.
 *
 * PERFORMANCE: hot paths (webRequest events, content rescans) must never do
 * a chrome.storage read per event. Use loadSettingsCached() — an in-memory
 * cache refreshed by a storage.onChanged watcher (watchSettings(), call once
 * per context) and invalidateSettingsCache() after explicit writes.
 */
import type { ScopeConfig } from './scope';
import { STORAGE_KEYS } from './constants';

export interface DiscoveryConfig {
  /** Fetch + statically analyze external script bundles (expensive, cached). */
  jsBundles: boolean;
  /** Observe browser request metadata (webRequest). */
  network: boolean;
  /** Harvest cookie NAMES for the scoped origin (values never read). */
  cookies: boolean;
  /** Harvest storage KEY names + sizes (values never read). */
  storage: boolean;
}

export interface ScopeSettings extends ScopeConfig {
  /** Field name reported in messages for UX clarity. */
  mode: 'origin';
  allowlist: string[];
  exclusions: string[];
  /** Gated pipeline logging (shared/debug.ts). */
  debug?: boolean;
  /** Per-module discovery switches — defaults prioritize browser performance. */
  discovery: DiscoveryConfig;
}

export const DEFAULT_SETTINGS: ScopeSettings = {
  mode: 'origin',
  allowlist: [],
  exclusions: [],
  discovery: { jsBundles: true, network: true, cookies: true, storage: true },
};

export async function loadSettings(): Promise<ScopeSettings> {
  const bag = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = (bag[STORAGE_KEYS.settings] ?? {}) as Partial<ScopeSettings>;
  return normalize(raw);
}

function normalize(raw: Partial<ScopeSettings>): ScopeSettings {
  const d = (raw.discovery ?? {}) as Partial<DiscoveryConfig>;
  return {
    mode: 'origin',
    allowlist: Array.isArray(raw.allowlist) ? raw.allowlist.filter((x): x is string => typeof x === 'string') : [],
    exclusions: Array.isArray(raw.exclusions) ? raw.exclusions.filter((x): x is string => typeof x === 'string') : [],
    debug: raw.debug === true,
    discovery: {
      jsBundles: d.jsBundles !== false,
      network: d.network !== false,
      cookies: d.cookies !== false,
      storage: d.storage !== false,
    },
  };
}

export async function saveSettings(settings: ScopeSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  invalidateSettingsCache();
}

// ─── in-memory cache (kills per-event storage reads) ────────────────────────

let cache: ScopeSettings | null = null;
let cachePromise: Promise<ScopeSettings> | null = null;

export async function loadSettingsCached(): Promise<ScopeSettings> {
  if (cache) return cache;
  if (!cachePromise) {
    cachePromise = loadSettings().then((s) => {
      cache = s;
      return s;
    });
  }
  return cachePromise;
}

export function invalidateSettingsCache(): void {
  cache = null;
  cachePromise = null;
}

/** Register the invalidation watcher — once per context (background/content). */
export function watchSettings(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.settings]) invalidateSettingsCache();
  });
}
