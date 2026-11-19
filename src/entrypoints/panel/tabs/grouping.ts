/**
 * entrypoints/panel/tabs/grouping.ts — URL-based parameter grouping.
 *
 * Pure client-side transformation of ALREADY-COLLECTED findings:
 * no scans, no storage writes, no messaging. Memoize at the call site
 * (useMemo keyed by the findings page) — recomputation is O(n).
 *
 * Association rule: a parameter may belong to MULTIPLE groups. The group
 * keys come from the parameter's url-association map (pathname→count),
 * which the background merges across scans — nothing is discarded.
 */
import type { Finding } from '@shared/types/finding';

export type GroupMode = 'path' | 'origin' | 'method';

export interface GroupOptions {
  mode: GroupMode;
  /** Conservative pattern collapse: /users/123 + /users/456 → /users/{id}. */
  collapsePatterns: boolean;
}

export interface ParamGroup {
  key: string;
  label: string;
  items: Finding[];
  /** Sum of per-group occurrences (display only). */
  totalOccurrences: number;
}

/** The association keys a finding belongs to for the given mode. */
function associationKeys(f: Finding, mode: GroupMode): string[] {
  const d = f.detail as Record<string, unknown>;
  const urls = (d?.urls ?? {}) as Record<string, number>;
  const fallback = String(d?.firstPageUrl ?? f.location ?? '');

  if (mode === 'method') {
    const methods = (d?.methods ?? []) as string[];
    return methods.length > 0 ? methods : ['—'];
  }

  if (mode === 'origin') {
    const origins = new Set<string>();
    for (const key of Object.keys(urls)) {
      try {
        origins.add(new URL(key, fallback).origin);
      } catch {
        // skip malformed association
      }
    }
    try {
      origins.add(new URL(fallback).origin);
    } catch {
      // keep whatever resolved
    }
    return origins.size > 0 ? [...origins] : ['unknown'];
  }

  // path mode: every associated pathname (multi-URL membership preserved)
  if (Object.keys(urls).length > 0) return Object.keys(urls);
  try {
    return [new URL(fallback).pathname];
  } catch {
    return ['unknown'];
  }
}

const NUMERIC_SEGMENT = /^\d{1,12}$/;

/**
 * Conservative pattern collapse: two paths share a shape when they are
 * identical except for segments that are purely numeric — those become
 * {id}. Paths with mixed/hex/uuid segments are NEVER merged (not reliable).
 */
function collapsePaths(paths: string[]): Map<string, string> {
  const shapeOf = (p: string): string =>
    p
      .split('/')
      .map((seg) => (NUMERIC_SEGMENT.test(seg) ? '{id}' : seg))
      .join('/');
  const shapes = new Map<string, { display: string; count: number }>();
  for (const p of paths) {
    const shape = shapeOf(p);
    const entry = shapes.get(shape) ?? { display: p, count: 0 };
    entry.count += 1;
    shapes.set(shape, entry);
  }
  const out = new Map<string, string>();
  for (const p of paths) {
    const shape = shapes.get(shapeOf(p))!;
    // only collapse when ≥2 distinct real paths share the shape
    out.set(p, shape.count >= 2 ? shapeOf(p) : p);
  }
  return out;
}

export function groupParams(
  findings: readonly Finding[],
  opts: GroupOptions,
): ParamGroup[] {
  const collapse = opts.mode === 'path' && opts.collapsePatterns
    ? collapsePaths(findings.flatMap((f) => associationKeys(f, 'path')))
    : null;

  const groups = new Map<string, ParamGroup>();
  for (const f of findings) {
    for (const key of associationKeys(f, opts.mode)) {
      const label = collapse?.get(key) ?? key;
      const groupKey = `${opts.mode}:${label}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = { key: groupKey, label, items: [], totalOccurrences: 0 };
        groups.set(groupKey, g);
      }
      g.items.push(f);
      g.totalOccurrences += f.occurrences;
    }
  }
  // stable order: largest group first, then label
  return [...groups.values()].sort(
    (a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label),
  );
}
