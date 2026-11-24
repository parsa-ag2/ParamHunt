/**
 * shared/scope.ts — scope gate for all collection.
 *
 * Rules (enforced in content scripts AND re-checked by the background):
 *  1. Exclusions always win.
 *  2. Default scope = the current origin only (safe by default).
 *  3. A non-empty allowlist extends scope; patterns may be:
 *     - `scheme://host/path` glob with `*` wildcards, or
 *     - a bare domain (`example.com`) matching that host and subdomains.
 * The background NEVER trusts the content script's own check — both run.
 */

export interface ScopeConfig {
  /** Glob patterns or bare domains; empty = current-origin only. */
  allowlist?: string[];
  /** Matching URLs are never collected, even if allowlisted. */
  exclusions?: string[];
}

export interface ScopeContext extends ScopeConfig {
  /** Origin of the site the user is working on (enables default scope). */
  currentOrigin: string;
}

export interface ScopeDecision {
  inScope: boolean;
  reason: 'excluded' | 'allowlist' | 'current-origin' | 'out-of-scope';
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape regex specials except *
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(url: URL, pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  if (p.includes('://')) return patternToRegex(p).test(url.href);
  // bare domain: exact host or any subdomain
  const host = url.hostname.toLowerCase();
  const target = p.toLowerCase().replace(/^\*\./, '');
  return host === target || host.endsWith(`.${target}`);
}

export function isInScope(url: string, ctx: ScopeContext): ScopeDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { inScope: false, reason: 'out-of-scope' };
  }

  for (const pattern of ctx.exclusions ?? []) {
    if (matchesPattern(parsed, pattern)) {
      return { inScope: false, reason: 'excluded' };
    }
  }

  if (parsed.origin === ctx.currentOrigin) {
    return { inScope: true, reason: 'current-origin' };
  }

  for (const pattern of ctx.allowlist ?? []) {
    if (matchesPattern(parsed, pattern)) {
      return { inScope: true, reason: 'allowlist' };
    }
  }

  return { inScope: false, reason: 'out-of-scope' };
}


/**
 * Request-scoped scope check — origin-aware, unlike isInScope's full-URL
 * pattern matching. Used by the webRequest gate where the "current origin"
 * is the origin the user is actively researching.
 *
 * Rules: exclusions always win; an exact origin match (scheme+host+port)
 * against the active research origins accepts the request; explicit
 * allowlist patterns still extend scope. A bare-origin allowlist pattern
 * also matches any URL on that origin (paths are not required to match).
 */
export interface RequestScopeContext {
  activeOrigins: readonly string[];
  allowlist?: readonly string[];
  exclusions?: readonly string[];
}

export function isRequestInScope(url: string, ctx: RequestScopeContext): ScopeDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { inScope: false, reason: 'out-of-scope' };
  }

  for (const pattern of ctx.exclusions ?? []) {
    if (matchesPattern(parsed, pattern)) return { inScope: false, reason: 'excluded' };
    const p = pattern.trim();
    if (p && !p.includes('://') && p.toLowerCase().replace(/^\*\./, '') === parsed.hostname.toLowerCase()) {
      return { inScope: false, reason: 'excluded' };
    }
  }

  for (const origin of ctx.activeOrigins) {
    try {
      if (parsed.origin === new URL(origin).origin) {
        return { inScope: true, reason: 'current-origin' };
      }
    } catch {
      // malformed active origin — skip
    }
  }

  for (const pattern of ctx.allowlist ?? []) {
    if (matchesPattern(parsed, pattern)) return { inScope: true, reason: 'allowlist' };
    const p = pattern.trim();
    if (p && !p.includes('://') && !p.includes('*')) {
      const host = parsed.hostname.toLowerCase();
      const target = p.toLowerCase().replace(/^\*\./, '');
      if (host === target || host.endsWith(`.${target}`)) {
        return { inScope: true, reason: 'allowlist' };
      }
    }
  }

  return { inScope: false, reason: 'out-of-scope' };
}
