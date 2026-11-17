/**
 * modules/event-monitor — skeleton (architecture phase).
 * Full design contract (purpose, APIs, permissions, I/O, limits, tests):
 * docs/MODULE_DESIGN.md#event-monitor. Implementation lands per roadmap.
 */
import type { ModuleDefinition } from '@shared/types/module';

export const eventMonitorModule: ModuleDefinition = {
  id: 'event-monitor',
  name: 'eventMonitor',
  description: 'TODO — see docs/MODULE_DESIGN.md#event-monitor',
  contexts: ['background'],
  requiredApis: [],
  start(_ctx) {
    // TODO(roadmap): implement — no logic in architecture phase.
  },
};
