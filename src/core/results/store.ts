/**
 * core/results/store.ts — the findings authority (results-manager core).
 *
 * Owns persistence (via StorageAdapter port), dedup, rotation and queries.
 * Background is the single writer; other contexts go through messages.
 *
 * Dedup: sha-256 over `dedupeKey` when the caller supplies one (e.g.
 * `param:<name>`), else over source|type|location|canonical-detail.
 * Re-observation of the same key bumps `occurrences` + `lastSeenAt`
 * instead of creating a second row.
 */
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { FindingDraft } from '@shared/types/module';
import type { Finding, FindingPage, FindingQuery } from '@shared/types/finding';

const MAX_FINDINGS = 10_000;

export interface AddResult {
  finding: Finding;
  duplicate: boolean;
}

export class FindingsStore {
  private cache: Finding[] | null = null;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly key: string,
    private readonly cryptoRef: Pick<Crypto, 'subtle'> = crypto,
    private readonly maxFindings: number = 10_000,
  ) {}

  async add(draft: FindingDraft): Promise<AddResult> {
    const items = await this.load();
    const hash = await this.hashOf(draft);
    const existing = items.find((f) => f.hash === hash);
    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = draft.observedAt;
      const newSample = draft.detail?.sample;
      if (typeof newSample === 'string' && existing.detail?.sample === undefined) {
        existing.detail.sample = newSample;
      }
      await this.persist(items);
      return { finding: existing, duplicate: true };
    }

    const finding: Finding = {
      ...draft,
      id: crypto.randomUUID(),
      hash,
      occurrences: 1,
      firstSeenAt: draft.observedAt,
      lastSeenAt: draft.observedAt,
      status: 'new',
    };
    items.push(finding);
    if (items.length > this.maxFindings) {
      items.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
      items.splice(0, items.length - this.maxFindings); // rotate oldest out
    }
    await this.persist(items);
    return { finding, duplicate: false };
  }

  async list(query: FindingQuery = {}): Promise<FindingPage> {
    const items = await this.load();
    const filtered = items.filter((f) => matches(f, query));
    const sorted = [...filtered].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 500;
    return {
      items: sorted.slice(offset, offset + limit),
      total: filtered.length,
      query,
    };
  }

  async setStatus(ids: readonly string[], status: Finding['status']): Promise<number> {
    const items = await this.load();
    let updated = 0;
    for (const f of items) {
      if (ids.includes(f.id)) {
        f.status = status;
        updated += 1;
      }
    }
    if (updated > 0) await this.persist(items);
    return updated;
  }

  async remove(ids: readonly string[]): Promise<number> {
    const items = await this.load();
    const idSet = new Set(ids);
    const remaining = items.filter((f) => !idSet.has(f.id));
    if (remaining.length !== items.length) {
      await this.persist(remaining);
    }
    return items.length - remaining.length;
  }

  async clear(): Promise<number> {
    const items = await this.load();
    await this.persist([]);
    return items.length;
  }

  /** Attach/replace a researcher note on a finding. */
  async setNote(id: string, note: string): Promise<number> {
    const items = await this.load();
    const f = items.find((x) => x.id === id);
    if (!f) return 0;
    f.note = note;
    await this.persist(items);
    return 1;
  }

  /** @internal test hook */
  async debugAll(): Promise<Finding[]> {
    return [...(await this.load())];
  }

  private async load(): Promise<Finding[]> {
    if (this.cache) return this.cache;
    const bag = await this.storage.get(this.key);
    this.cache = Array.isArray(bag) ? (bag as Finding[]) : [];
    return this.cache;
  }

  private async persist(items: Finding[]): Promise<void> {
    this.cache = items;
    await this.storage.set(this.key, items);
  }

  private async hashOf(draft: FindingDraft): Promise<string> {
    const canonical =
      draft.dedupeKey ??
      `${draft.source}|${draft.type}|${draft.location}|${canonicalDetail(draft.detail)}`;
    const digest = await this.cryptoRef.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

/** Stable key sort so identical details hash identically. */
function canonicalDetail(detail: Record<string, unknown>): string {
  const keys = Object.keys(detail).sort();
  const parts = keys.map((k) => `${k}=${JSON.stringify(detail[k])}`);
  return parts.join('&');
}

function matches(f: Finding, q: FindingQuery): boolean {
  if (q.sources && !q.sources.includes(f.source)) return false;
  if (q.types && !q.types.includes(f.type)) return false;
  if (q.severities && !q.severities.includes(f.severity)) return false;
  if (q.statuses && !q.statuses.includes(f.status)) return false;
  if (q.locationIncludes && !f.location.includes(q.locationIncludes)) return false;
  if (q.seenAfter && f.lastSeenAt < q.seenAfter) return false;
  if (q.seenBefore && f.lastSeenAt > q.seenBefore) return false;
  return true;
}
