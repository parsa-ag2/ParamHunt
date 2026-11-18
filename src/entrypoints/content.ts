/**
 * entrypoints/content.ts — content script (isolated world).
 *
 * Facts:
 *  - Runs in an ISOLATED WORLD: shares the page DOM, separate JS context —
 *    page globals (and page JS objects) are NOT visible here.
 *  - MAIN-world logic (postMessage instrumentation) requires injecting a
 *    separate script into the page context via manifest `world: "MAIN"`
 *    registered content script (MV3) or web_accessible_resources — never
 *    via eval. See docs/SECURITY_MODEL.md §MAIN-world.
 *  - DOM listening (MutationObserver) and chrome.runtime messaging only.
 *
 * NOTE: `defineContentScript` is a WXT auto-import (no import line needed).
 *
 * TODO(M1+): param harvesting from live DOM/forms + location; storage
 * snapshots on demand; postMessage relay from the MAIN-world injector.
 */

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    console.log('[ParamHunt] content script ready', location.href);
    // TODO(M1+): DOM/param harvesting — emit via bridge, never touch page JS.
  },
});
