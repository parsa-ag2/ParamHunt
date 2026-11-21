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

  async addMany(inputs: readonly EndpointInput[]): Promise<number> {
    const items = await this.load();
    let added = 0;
    for (const input of inputs) {
      const method = input.method || 'UNKNOWN';
      const key = `${method}|${input.path}`;
      const existing = items.find((r) => r.key === key);
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeenAt = new Date().toISOString();
        if (!existing.sources.includes(input.source)) existing.sources.push(input.source);
        if (input.evidence) {
          const ek = this.evKey(input.evidence);
          if (!existing.evidence.some((e) => this.evKey(e) === ek) && existing.evidence.length < 10) {
            existing.evidence.push(input.evidence);
          }
        }
        if (!existing.sourceFiles.includes(input.evidence?.url ?? '')) {
          const sf = input.evidence?.url;
          if (sf) existing.sourceFiles.push(sf);
        }
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
    if (added > 0) {
      if (items.length > this.maxEndpoints) {
        items.sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
        items.splice(0, items.length - this.maxEndpoints);
      }
      this.cache = items;
      this.scheduleFlush(added >= 25 ? 0 : this.flushDelayMs);
    }
    return added;
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
