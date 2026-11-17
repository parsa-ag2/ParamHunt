/**
 * modules/http-analyzer — skeleton (architecture phase).
 * Full design contract (purpose, APIs, permissions, I/O, limits, tests):
 * docs/MODULE_DESIGN.md#http-analyzer. Implementation lands per roadmap.
 */
import type { ModuleDefinition } from '@shared/types/module';

export const httpAnalyzerModule: ModuleDefinition = {
  id: 'http-analyzer',
  name: 'httpAnalyzer',
  description: 'TODO — see docs/MODULE_DESIGN.md#http-analyzer',
  contexts: ['background'],
  requiredApis: [],
  start(_ctx) {
    // TODO(roadmap): implement — no logic in architecture phase.
  },
};
