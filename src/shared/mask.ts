/**
 * shared/mask.ts — sensitive-value masking for display and copy paths.
 *
 * ParamHunt shows URL structures, not secrets. Values of credential-ish
 * parameters are masked by default; unmasking is an explicit user action.
 * Cookie values are NEVER displayed (metadata-only module).
 */
import type { UrlRecord } from './types/http';

const SENSITIVE_KEY = /(token|auth|key|secret|pass(word)?|session|jwt|bearer|sig(nature)?|nonce|otp|otp_?code|access_?token|refresh|api[_-]?key|client_?id|code$)/i;

export function isSensitiveKey(name: string): boolean {
  return SENSITIVE_KEY.test(name);
}

/** Mask the VALUES of sensitive query parameters in a URL string. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (![...u.searchParams.keys()].some(isSensitiveKey)) return url;
    for (const key of [...u.searchParams.keys()]) {
      if (isSensitiveKey(key) && u.searchParams.get(key)) {
        u.searchParams.set(key, '***');
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** Display-ready URL record (values masked by default). */
export function maskUrlRecord(record: UrlRecord): UrlRecord {
  return { ...record, url: maskUrl(record.url) };
}

/**
 * Copy-ready URL. Masked by default; the caller may pass
 * `{ includeValues: true }` after an explicit user action.
 */
export function urlForCopy(url: string, opts: { includeValues?: boolean } = {}): string {
  if (opts.includeValues) return url;
  return maskUrl(url);
}
