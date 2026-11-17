/**
 * entrypoints/devtools/devtools.ts — DevTools integration entry.
 *
 * Runs in the DEVTOOLS PAGE context: has chrome.devtools.* plus most
 * extension APIs. `inspectedWindow.tabId` identifies the target tab.
 *
 * Why a DevTools panel for this tool (decision — docs/TECHNICAL_DECISIONS #5):
 *  - popup dies on close; a devtools panel persists for the whole inspection
 *    session, has full-width real estate for result tables, and sits exactly
 *    where web researchers already work.
 *  - Network details require the debugger API or CDP — available from the
 *    devtools context without extra user gestures.
 *
 * TODO(M2): chrome.devtools.panels.create('ParamHunt', icon, 'panel.html').
 */
console.log('[ParamHunt] devtools page loaded for tab', chrome.devtools.inspectedWindow.tabId);
