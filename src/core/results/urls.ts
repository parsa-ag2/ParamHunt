/**
 * core/results/urls.ts — URL catalog store (page + network sources).
 *
 * Ring-buffer keyed by URL; occurrences merge across sightings.
 */
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { UrlRecord, UrlSource } from '@shared/types/http';

export interface UrlInput {
  url: string;
  method?: 'GET' | 'POST' | 'OTHER';
  source: UrlSource;
}

export class UrlsStore {
  private cache: UrlRecord[] | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly key: string,
    private readonly maxUrls = 500,
    /** Persistence debounce — hot request paths must not write per event. */
    private readonly flushDelayMs = 2_500,
  ) {}

  /**
   * Merge into the in-memory catalog immediately; persist DEBOUNCED so a
   * request-heavy page cannot thrash chrome.storage (flushes ≤1 per 2.5s,
   * plus an immediate flush when the batch grows large).
   */
  async addMany(inputs: readonly UrlInput[]): Promise<{ added: number; updated: number }> {
    const items = await this.load();
    let added = 0;
    let updated = 0;
    for (const input of inputs) {
      const parsed = normalize(input.url);
      if (!parsed) continue;
      const key = parsed.href;
      const existing = items.find((r) => r.url === key);
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeenAt = new Date().toISOString();
        if (!existing.sources.includes(input.source)) {
          existing.sources.push(input.source); // preserve ALL discovery sources
          updated += 1; // a real metadata change, not just a repeat sighting
        }
        continue;
      }
      const nowIso = new Date().toISOString();
      items.push({
        url: key,
        origin: parsed.origin,
        path: parsed.pathname,
        method: input.method ?? 'GET',
        sources: [input.source],
        paramNames: [...parsed.searchParams.keys()],
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        occurrences: 1,
      });
      added += 1;
    }
    // persist on NEW records AND on meaningful metadata updates (occurrence
    // bumps / source merges) — the v0.5 bug skipped persistence when only
    // existing records were touched
    if (added + updated > 0) {
      if (items.length > this.maxUrls) {
        items.sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
        items.splice(0, items.length - this.maxUrls);
      }
      this.cache = items;
      this.scheduleFlush(added >= 25 ? 0 : this.flushDelayMs);
    }
    return { added, updated };
  }

  async list(originFilter?: string): Promise<UrlRecord[]> {
    const items = await this.load();
    const filtered = originFilter ? items.filter((r) => r.origin === originFilter) : items;
    return [...filtered].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  async clear(): Promise<number> {
    const items = await this.load();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.persist([]);
    return items.length;
  }

  /** Force-write the in-memory catalog (used by tests and shutdown paths). */
  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (this.cache) await this.persist(this.cache);
  }

  /** @internal test hook */
  async debugAll(): Promise<UrlRecord[]> {
    return [...(await this.load())];
  }

  private scheduleFlush(delay: number): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (this.cache) void this.persist(this.cache);
    }, delay);
  }

  private async load(): Promise<UrlRecord[]> {
    if (this.cache) return this.cache;
    const bag = await this.storage.get(this.key);
    const items = Array.isArray(bag) ? (bag as UrlRecord[]) : [];
    // migration: pre-v0.4 records stored a single `source` field
    for (const r of items) {
      if (!Array.isArray(r.sources)) {
        const legacy = (r as unknown as { source?: string }).source;
        r.sources = legacy ? [legacy as UrlSource] : ['other'];
      }
    }
    this.cache = items;
    return this.cache;
  }

  private async persist(items: UrlRecord[]): Promise<void> {
    this.cache = items;
    await this.storage.set(this.key, items);
  }
}

function normalize(url: string): URL | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}
