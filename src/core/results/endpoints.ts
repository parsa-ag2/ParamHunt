/**
 * core/results/endpoints.ts — endpoint catalog store.
 *
 * Ring-buffer keyed by `METHOD|path` (dedup: same endpoint re-discovered
 * bumps occurrences + merges sources/evidence). Persistence is debounced —
 * hot discovery paths must not write per event.
 */
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { EndpointRecord } from '@shared/types/http';

export interface EndpointInput {
  url: string;
  path: string;
  method: string;
  methodConfidence: EndpointRecord['methodConfidence'];
  category: EndpointRecord['category'];
  source: EndpointRecord['sources'][number];
  evidence: EndpointRecord['evidence'][number];
  paramNames?: string[];
}

export class EndpointsStore {
  private cache: EndpointRecord[] | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly key: string,
    private readonly maxEndpoints = 1_000,
    private readonly flushDelayMs = 2_000,
  ) {}

  private evKey(e: EndpointRecord['evidence'][number]): string {
    return `${e.url ?? ''}|${e.line ?? ''}|${e.column ?? ''}|${e.snippet ?? ''}`;
  }

  async addMany(inputs: readonly EndpointInput[]): Promise<{ added: number; updated: number }> {
    const items = await this.load();
    let added = 0;
    let updated = 0;
    for (const input of inputs) {
      const method = input.method || 'UNKNOWN';
      // identity includes ORIGIN — /api/users on two different API hosts
      // are different endpoints; unresolved-origin candidates keep their
      // own identity space (origin '') and never corrupt known-origin ones
      const key = `${method}|${safeOrigin(input.url) || ''}|${input.path}`;
      const existing = items.find((r) => r.key === key);
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeenAt = new Date().toISOString();
        if (!existing.sources.includes(input.source)) {
          existing.sources.push(input.source);
          updated += 1;
        }
        if (input.evidence) {
          const ek = this.evKey(input.evidence);
          if (!existing.evidence.some((e) => this.evKey(e) === ek) && existing.evidence.length < 10) {
            existing.evidence.push(input.evidence);
            updated += 1;
          }
        }
        // never overwrite a useful absolute URL with an empty one
        if (!existing.url && input.url) existing.url = input.url;
        if (!existing.origin && input.url) existing.origin = safeOrigin(input.url);
        for (const pn of input.paramNames ?? []) {
          if (!existing.paramNames.includes(pn)) existing.paramNames.push(pn);
        }
        updated += 1; // real metadata change → schedule persistence (v0.5 bug class)
        continue;
      }
      const nowIso = new Date().toISOString();
      items.push({
        key,
        url: input.url,
        origin: input.url ? safeOrigin(input.url) : '',
        path: input.path,
        method,
        methodConfidence: input.methodConfidence,
        category: input.category,
        sources: [input.source],
        sourceFiles: input.evidence?.url ? [input.evidence.url] : [],
        evidence: input.evidence ? [input.evidence] : [],
        paramNames: input.paramNames ?? [],
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        occurrences: 1,
      });
      added += 1;
    }
    if (added + updated > 0) {
      if (items.length > this.maxEndpoints) {
        items.sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
        items.splice(0, items.length - this.maxEndpoints);
      }
      this.cache = items;
      this.scheduleFlush(added >= 25 ? 0 : this.flushDelayMs);
    }
    return { added, updated };
  }

  async list(originFilter?: string): Promise<EndpointRecord[]> {
    const items = await this.load();
    const filtered = originFilter ? items.filter((r) => r.origin === originFilter) : items;
    return [...filtered].sort(
      (a, b) => b.occurrences - a.occurrences || a.path.localeCompare(b.path),
    );
  }

  async clear(): Promise<number> {
    const items = await this.load();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.persist([]);
    return items.length;
  }

  /** Force-write the in-memory catalog (tests + shutdown paths). */
  async flush(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (this.cache) await this.persist(this.cache);
  }

  /** @internal test hook */
  async debugAll(): Promise<EndpointRecord[]> {
    return [...(await this.load())];
  }

  private scheduleFlush(delay: number): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (this.cache) void this.persist(this.cache);
    }, delay);
  }

  private async load(): Promise<EndpointRecord[]> {
    if (this.cache) return this.cache;
    const bag = await this.storage.get(this.key);
    this.cache = Array.isArray(bag) ? (bag as EndpointRecord[]) : [];
    return this.cache;
  }

  private async persist(items: EndpointRecord[]): Promise<void> {
    this.cache = items;
    await this.storage.set(this.key, items);
  }
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
