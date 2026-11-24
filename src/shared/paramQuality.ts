/**
 * shared/paramQuality.ts — the confirmed vs possible parameter boundary.
 *
 * ONE predicate used by the Popup, DevTools Overview, Parameters default
 * view and Findings counters so every surface counts the SAME effective
 * parameter set. Weak JS object candidates (framework artifacts) are
 * "possible" — preserved in storage, shown behind a filter, never counted
 * as confirmed discoveries.
 *
 * Performance: O(1) per finding, no storage access, no regex on hot paths.
 */
import type { Finding } from './types/finding';

/** Weak JS-object candidate: framework artifact or unverified key. */
export function isPossibleParam(f: Finding): boolean {
  if (f.source !== 'param-discovery') return false;
  const d = f.detail as Record<string, unknown> | undefined;
  const confidence = String(d?.confidence ?? 'low');
  const kinds = (d?.kinds ?? []) as string[];
  return confidence === 'low' && kinds.includes('js-object');
}

/** Confirmed discovery: everything except weak JS-object candidates. */
export function isConfirmedParam(f: Finding): boolean {
  return !isPossibleParam(f);
}

export function countConfirmed(findings: readonly Finding[]): number {
  let n = 0;
  for (const f of findings) if (isConfirmedParam(f)) n += 1;
  return n;
}
