/**
 * core/engine/Engine.ts — the modular core.
 *
 * Responsibilities (docs/SYSTEM_ARCHITECTURE.md §Engine):
 *  - module registration + lifecycle (start/stop, restart-safe)
 *  - event distribution (typed EventBus)
 *  - configuration management (storage adapter)
 *  - error handling (one module's failure never kills the engine)
 *  - result normalization hand-off (findings -> results-manager)
 *
 * Skeleton (architecture phase): orchestration logic lands in roadmap M0.
 */
import { EventBus } from './EventBus';
import { ModuleRegistry } from './ModuleRegistry';
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { EngineEvents, ModuleContext, ModuleDefinition, ModuleId } from '@shared/types/module';
import type { FindingDraft } from '@shared/types/module';

export interface EngineOptions {
  storage: StorageAdapter;
  /** Called when a finding enters the pipeline (wire to results-manager). */
  onFinding?: (draft: FindingDraft) => Promise<void>;
  logger?: Console;
}

export class Engine {
  readonly bus = new EventBus();
  readonly registry = new ModuleRegistry();

  constructor(private readonly options: EngineOptions) {}

  register(definition: ModuleDefinition): void {
    this.registry.register(definition);
  }

  /**
   * Start the engine. Restart-safe: the MV3 service worker can be killed at
   * any time; start() must be idempotent and re-attach all chrome listeners.
   * TODO(M0): iterate registry.resolveStartOrder(), build ModuleContext per
   * module, start with per-module try/catch + error isolation.
   */
  async start(): Promise<void> {
    // TODO(M0): lifecycle implementation.
  }

  async stop(): Promise<void> {
    // TODO(M0): stop in reverse dependency order, flush pending findings.
  }

  /** Build the service bundle a module receives. */
  protected createContext(moduleId: ModuleId): ModuleContext {
    return {
      moduleId,
      emit: (event, payload) => this.bus.emit(event, payload),
      on: (event, handler) => this.bus.on(event, handler),
      recordFinding: async (draft) => {
        await this.options.onFinding?.(draft);
      },
      logger: console as unknown as Console,
      settings: {
        get: async (key) => this.options.storage.get(`modules.${moduleId}.${key}`),
        set: async (key, value) => {
          await this.options.storage.set(`modules.${moduleId}.${key}`, value);
        },
      },
    };
  }
}

/** Exposed for tests only — engine events vocabulary re-export. */
export type { EngineEvents };
