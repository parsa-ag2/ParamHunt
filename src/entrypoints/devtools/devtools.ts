/**
 * entrypoints/devtools/devtools.ts — DevTools integration entry.
 *
 * Runs in the DEVTOOLS PAGE context. Creates the ParamHunt panel — this was
 * the v0.0.1 root cause of "results not displayed": the panel was never
 * registered, so panel.html was unreachable.
 *
 * `inspectedWindow.tabId` identifies the target tab for the panel UI.
 */
import { createPipelineLogger, pipelineError } from '@shared/debug';

const log = createPipelineLogger('devtools');

try {
  chrome.devtools.panels.create('ParamHunt', '/icons/icon-32.png', 'panel.html', (panel) => {
    log('ui', 'panel created', { panel: panel.toString() });
  });
} catch (err) {
  pipelineError('devtools', 'error', 'panel creation failed', err);
}
