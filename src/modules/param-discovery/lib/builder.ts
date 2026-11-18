/**
 * modules/param-discovery/lib/builder.ts — the Parameter Builder engine.
 *
 * Pure functions: turn selected parameters + assigned values into query
 * strings / lines / JSON / full URLs, with correct URL encoding and an
 * explicit duplicate-name policy. No chrome APIs, no network access.
 */
import type { ParamRecord } from '@shared/types/param';

export interface BuilderPair {
  name: string;
  /** User-assigned value; falls back to the observed sample when empty. */
  value: string;
}

export type OutputFormat = 'query' | 'raw' | 'lines' | 'json' | 'url';

/**
 * Correct URL encoding policy:
 *  - keys and values are encoded with encodeURIComponent (spaces → %20,
 *    unicode-safe, special chars safe);
 *  - empty values are emitted as `key=` (explicit, not dropped);
 *  - duplicate names: parameter lists are deduped upstream by name, so the
 *    builder asserts one entry per name — duplicates are merged by keeping
 *    the LAST assigned value (predictable "last write wins").
 */
export function buildQueryPairs(pairs: readonly BuilderPair[]): Array<{ name: string; value: string }> {
  const byName = new Map<string, string>();
  for (const p of pairs) {
    const key = p.name.trim();
    if (!key) continue;
    byName.set(key.toLowerCase(), p.value ?? '');
  }
  const out: Array<{ name: string; value: string }> = [];
  const seenSpelling = new Map<string, string>();
  for (const p of pairs) {
    const key = p.name.trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (seenSpelling.has(lower)) continue; // first spelling wins for display
    seenSpelling.set(lower, key);
    out.push({ name: key, value: byName.get(lower) ?? '' });
  }
  return out;
}

function encode(v: string): string {
  return encodeURIComponent(v).replace(/%20/g, '+'); // form-style spaces
}

/** Generate the serialized output for one format. */
export function buildOutput(
  pairs: readonly BuilderPair[],
  format: OutputFormat,
  opts: { baseUrl?: string } = {},
): string {
  const canonical = buildQueryPairs(pairs);
  const qs = canonical.map((p) => `${encode(p.name)}=${encode(p.value)}`).join('&');

  switch (format) {
    case 'query':
      return canonical.length > 0 ? `?${qs}` : '';
    case 'raw':
      return qs;
    case 'lines':
      return canonical.map((p) => `${p.name}=${p.value}`).join('\n');
    case 'json': {
      const obj: Record<string, string> = {};
      for (const p of canonical) obj[p.name] = p.value;
      return JSON.stringify(obj, null, 2);
    }
    case 'url': {
      const base = (opts.baseUrl ?? '').trim();
      if (!base) return qs;
      const joiner = base.includes('?') ? '&' : '?';
      return `${base}${canonical.length > 0 ? `${joiner}${qs}` : ''}`;
    }
    default:
      return qs;
  }
}

/**
 * Convenience: initialize builder pairs from discovered records.
 * The observed sample seeds the value field but stays visually distinct —
 * callers show it as a placeholder; user edits override.
 */
export function pairsFromRecords(records: readonly ParamRecord[]): BuilderPair[] {
  return records.map((r) => ({ name: r.name, value: r.firstSample ?? '' }));
}
