/**
 * modules/param-discovery/lib/format.ts — copy/export formatting helpers.
 */
import type { Finding } from '@shared/types/finding';

/** Extract the parameter name from a param-discovery finding title (`param: <name>`). */
export function paramName(finding: Finding): string {
  return finding.title.startsWith('param: ') ? finding.title.slice(7) : finding.title;
}

/**
 * Unique parameter names, de-duplicated case-insensitively, preserving the
 * input order (first spelling wins) — the predictable order Copy All needs.
 */
export function uniqueParamNames(findings: readonly Finding[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of findings) {
    const name = paramName(f);
    const key = name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Names joined for the clipboard: one per line, no trailing newline. */
export function namesToClipboardText(names: readonly string[]): string {
  return names.join('\n');
}
