/**
 * shared/clipboard.ts — real clipboard write with honest failure reporting.
 *
 * Primary: navigator.clipboard.writeText (needs document focus — true for
 * popup + devtools panel when the user just clicked).
 * Fallback: hidden textarea + document.execCommand('copy') for contexts
 * where the async Clipboard API is unavailable/permission-blocked.
 * Returns true ONLY on verified success — callers must not fake success.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the execCommand path
  }
  return fallbackCopy(text);
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
