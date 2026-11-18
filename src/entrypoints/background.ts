/**
 * entrypoints/background.ts — the MV3 service worker.
 *
 * Lifecycle facts (official docs — verify pass pending, see roadmap):
 *  - The SW is event-driven and Chromium may suspend it at ANY idle moment.
 *    Every chrome.* listener MUST be attached synchronously at the top level;
 *    async work happens inside handlers, never before registration.
 *  - State must survive suspension: keep it in chrome.storage, never in
 *    module-level variables alone.
 *  - websocket/keepalive tricks are NOT planned — event-driven by design.
 *
 * NOTE: `defineBackground` and `browser` are WXT auto-imports (no import line
 * needed — matches wxt-dev templates; explicit 'wxt' import breaks prepare).
 *
 * TODO(M0): boot Engine here with the chrome-backed StorageAdapter, register
 * modules, attach runtime.onMessage router (core/messaging/bridge).
 */

export default defineBackground(() => {
  console.log('[ParamHunt] background booted', { id: browser.runtime.id });
  // TODO(M0): engine boot + listener registration (synchronous top level).
});
