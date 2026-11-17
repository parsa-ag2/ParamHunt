/**
 * modules/dom-inspector — skeleton (architecture phase).
 * Full design contract (purpose, APIs, permissions, I/O, limits, tests):
 * docs/MODULE_DESIGN.md#dom-inspector. Implementation lands per roadmap.
 */
import type { ModuleDefinition } from '@shared/types/module';

export const domInspectorModule: ModuleDefinition = {
  id: 'dom-inspector',
  name: 'domInspector',
  description: 'TODO — see docs/MODULE_DESIGN.md#dom-inspector',
  contexts: ['background'],
  requiredApis: [],
  start(_ctx) {
    // TODO(roadmap): implement — no logic in architecture phase.
  },
};
