/**
 * core/engine/Engine.ts — the modular core.
 *
 * Responsibilities:
 *  - module registration + lifecycle (start/stop, restart-safe)
 *  - event distribution (typed EventBus, in-context only)
 *  - error isolation: one module's failure never kills the engine
 *  - finding pipeline: recordFinding → onFinding hook (results-manager)
 *  - per-module settings (namespaced under modules.<id>)
 */
import { EventBus } from './EventBus';
import { ModuleRegistry } from './ModuleRegistry';
import type { StorageAdapter } from '../storage/StorageAdapter';
import type { EngineEvents, ModuleContext, ModuleDefinition, ModuleId, ModuleStatus } from '@shared/types/module';
import type { FindingDraft } from '@shared/types/module';

export interface EngineOptions {
  /** Storage backend (module settings + engine state). */
  storage: StorageAdapter;
  /** Called when a finding enters the pipeline (wire to results-manager). */
  onFinding?: (draft: FindingDraft) => Promise<void>;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

export class Engine {
  readonly bus = new EventBus();
  readonly registry = new ModuleRegistry();

  private running = false;
  private readonly statuses = new Map<ModuleId, ModuleStatus>();
  private readonly contexts = new Map<ModuleId, ModuleContext>();

  constructor(private readonly options: EngineOptions) {}

  register(definition: ModuleDefinition): void {
    this.registry.register(definition);
  }

  isRunning(): boolean {
    return this.running;
  }

  statusList(): readonly { id: ModuleId; status: ModuleStatus }[] {
    return [...this.statuses.entries()].map(([id, status]) => ({ id, status }));
  }

  /**
   * Start the engine. Restart-safe: the MV3 service worker can be killed at
   * any time; call this again after every restart — already-started modules
   * are skipped and listeners must have been re-attached by their modules.
   */
  async start(): Promise<void> {
    if (this.running) return;
    const order = this.registry.resolveStartOrder();
    for (const mod of order) {
      if (this.statuses.get(mod.id) === 'started') continue;
      const ctx = this.createContext(mod.id);
      this.contexts.set(mod.id, ctx);
      this.statuses.set(mod.id, 'registered');
      try {
        await mod.start(ctx);
        this.statuses.set(mod.id, 'started');
      } catch (err) {
        this.statuses.set(mod.id, 'error');
        ctx.logger.error(`module start failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.running = true;
    this.bus.emit('engine:started', { reason: 'startup' });
  }

  /** Stop in reverse start order; idempotent. */
  async stop(): Promise<void> {
    if (!this.running) return;
    for (const mod of [...this.registry.resolveStartOrder()].reverse()) {
      if (this.statuses.get(mod.id) !== 'started') continue;
      try {
        await mod.stop?.();
        this.statuses.set(mod.id, 'stopped');
      } catch (err) {
        this.statuses.set(mod.id, 'error');
        this.options.logger?.warn(`module stop failed (${mod.id}):`, err);
      }
    }
    this.running = false;
    this.bus.emit('engine:stopping', { reason: 'shutdown' });
  }

  statusOf(id: ModuleId): ModuleStatus {
    return this.statuses.get(id) ?? 'registered';
  }

  /** Build the service bundle a module receives. */
  protected createContext(moduleId: ModuleId): ModuleContext {
    const log = this.options.logger ?? console;
    const ns = `[ParamHunt:${moduleId}]`;
    const prefix = `modules.${moduleId}`;
    return {
      moduleId,
      emit: (event, payload) => this.bus.emit(event, payload),
      on: (event, handler) => this.bus.on(event, handler),
      recordFinding: async (draft) => {
        await this.options.onFinding?.(draft);
      },
      logger: {
        debug: (msg, ...meta) => log.debug(ns, msg, ...meta),
        info: (msg, ...meta) => log.info(ns, msg, ...meta),
        warn: (msg, ...meta) => log.warn(ns, msg, ...meta),
        error: (msg, ...meta) => log.error(ns, msg, ...meta),
      },
      settings: {
        get: async (key) => this.options.storage.get(`${prefix}.${key}`),
        set: async (key, value) => {
          await this.options.storage.set(`${prefix}.${key}`, value);
        },
      },
    };
  }
}

/** Exposed for tests only — engine events vocabulary re-export. */
export type { EngineEvents };
