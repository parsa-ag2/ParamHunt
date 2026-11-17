/**
 * shared/types/finding.ts — persisted finding model + query shapes.
 *
 * FindingDraft (module.ts) is what modules produce; Finding is what the
 * results-manager stores after normalization + dedup. Keeping them separate
 * lets the storage layer evolve (e.g. add hashes) without touching modules.
 */
import type { FindingDraft, ModuleId } from './module';

export interface Finding extends FindingDraft {
  /** Server-assigned unique id (ULID/uuid — see TECHNICAL_DECISIONS #7). */
  id: string;
  /** Dedup key: sha-256(source|type|location|canonical-detail). */
  hash: string;
  /** Incremented when the same hash is seen again. */
  occurrences: number;
  /** RFC 3339 first-seen time. */
  firstSeenAt: string;
  /** RFC 3339 last-seen time. */
  lastSeenAt: string;
  /** User-applied state for triage workflow. */
  status: 'new' | 'reviewed' | 'confirmed' | 'ignored';
}

/** Query interface for the results browser (popup / devtools panel). */
export interface FindingQuery {
  sources?: readonly ModuleId[];
  types?: readonly string[];
  severities?: FindingDraft['severity'][];
  statuses?: Finding['status'][];
  locationIncludes?: string;
  /** ISO date range on lastSeenAt. */
  seenAfter?: string;
  seenBefore?: string;
  limit?: number;
  offset?: number;
}

export interface FindingPage {
  items: Finding[];
  total: number;
  query: FindingQuery;
}
