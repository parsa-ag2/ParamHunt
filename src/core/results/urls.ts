/**
 * core/results/urls.ts — URL catalog store (page + network sources).
 *
 * Ring-buffer keyed by URL; occurrences merge across sightings.
 */
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { UrlRecord } from '@shared/types/http';

export interface UrlInput {
  url: string;
  method?: 'GET' | 'POST' | 'OTHER';
  source: 'page' | 'network';
}

export class UrlsStore {
  private cache: UrlRecord[] | null = null;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly key: string,
    private readonly maxUrls = 500,
  ) {}

  async addMany(inputs: readonly UrlInput[]): Promise<number> {
    const items = await this.load();
    let added = 0;
    for (const input of inputs) {
      const parsed = normalize(input.url);
      if (!parsed) continue;
      const key = parsed.href;
      const existing = items.find((r) => r.url === key);
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeenAt = new Date().toISOString();
        if (input.source === 'network' && existing.source === 'page') {
          existing.source = 'network'; // network sighting is the stronger evidence
        }
        continue;
      }
      const nowIso = new Date().toISOString();
      items.push({
        url: key,
        origin: parsed.origin,
        path: parsed.pathname,
        method: input.method ?? 'GET',
        source: input.source,
        paramNames: [...parsed.searchParams.keys()],
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        occurrences: 1,
      });
      added += 1;
    }
    if (added > 0) {
      if (items.length > this.maxUrls) {
        items.sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
        items.splice(0, items.length - this.maxUrls);
      }
      await this.persist(items);
    }
    return added;
  }

  async list(originFilter?: string): Promise<UrlRecord[]> {
    const items = await this.load();
    const filtered = originFilter ? items.filter((r) => r.origin === originFilter) : items;
    return [...filtered].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  async clear(): Promise<number> {
    const items = await this.load();
    await this.persist([]);
    return items.length;
  }

  /** @internal test hook */
  async debugAll(): Promise<UrlRecord[]> {
    return [...(await this.load())];
  }

  private async load(): Promise<UrlRecord[]> {
    if (this.cache) return this.cache;
    const bag = await this.storage.get(this.key);
    this.cache = Array.isArray(bag) ? (bag as UrlRecord[]) : [];
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
