/**
 * modules/export-engine — skeleton (architecture phase).
 * Full design contract (purpose, APIs, permissions, I/O, limits, tests):
 * docs/MODULE_DESIGN.md#export-engine. Implementation lands per roadmap.
 */
import type { ModuleDefinition } from '@shared/types/module';
export { findingsToCsv } from './lib/csv';

export const exportEngineModule: ModuleDefinition = {
  id: 'export-engine',
  name: 'exportEngine',
  description: 'TODO — see docs/MODULE_DESIGN.md#export-engine',
  contexts: ['background'],
  requiredApis: [],
  start(_ctx) {
    // TODO(roadmap): implement — no logic in architecture phase.
  },
};
