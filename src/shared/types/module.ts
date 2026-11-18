/**
 * shared/types/module.ts — module contract for the ParamHunt core engine.
 *
 * Every analysis capability (HTTP, params, DOM, postMessage, JS, events,
 * storage) is a Module: a self-contained unit registered with the Engine.
 * Modules never talk to each other directly — only through the EventBus
 * and the typed message protocol. See docs/SYSTEM_ARCHITECTURE.md.
 */

/** Stable identifiers for the built-in modules. */
export type ModuleId =
  | 'http-analyzer'
  | 'param-discovery'
  | 'dom-inspector'
  | 'postmessage-tracker'
  | 'js-analyzer'
  | 'event-monitor'
  | 'storage-inspector'
  | 'results-manager'
  | 'export-engine';

/** Execution context where a module's logic lives. */
export type RunContext = 'background' | 'content' | 'devtools' | 'popup' | 'options';

/** Lifecycle phases managed by the Engine. */
export type ModuleStatus = 'registered' | 'started' | 'stopped' | 'error';

/**
 * The single contract every module implements. Deliberately small:
 * metadata + lifecycle + optional event handlers. Rich module-specific
 * behavior lives inside the module and is exposed via messages, not imports.
 */
export interface ModuleDefinition {
  /** Globally unique id (ModuleId). */
  readonly id: ModuleId;
  /** Human-readable name shown in UI. */
  readonly name: string;
  /** One-line description (used in UI + docs). */
  readonly description: string;
  /** Context(s) the module primarily runs in. */
  readonly contexts: readonly RunContext[];
  /** Chrome APIs this module requires (validated by the Engine at start). */
  readonly requiredApis: readonly string[];
  /** Modules that must start first (e.g. results-manager before emitters). */
  readonly dependencies?: readonly ModuleId[];
  /** Called once when the Engine starts (and on SW restart). */
  start(ctx: ModuleContext): void | Promise<void>;
  /** Called on engine stop / SW suspension cleanup. Must be idempotent. */
  stop?(): void | Promise<void>;
}

/**
 * Runtime services the Engine hands to each module. Keeps modules
 * decoupled from chrome.* details and makes them testable with fakes.
 */
export interface ModuleContext {
  /** Id of the module owning this context. */
  readonly moduleId: ModuleId;
  /** Publish an event on the engine bus (typed via EventBus). */
  readonly emit: <E extends keyof EngineEvents>(event: E, payload: EngineEvents[E]) => void;
  /** Subscribe to engine events; returns an unsubscribe function. */
  readonly on: <E extends keyof EngineEvents>(
    event: E,
    handler: (payload: EngineEvents[E]) => void,
  ) => () => void;
  /** Persist a finding via the results pipeline (results-manager owns storage). */
  readonly recordFinding: (finding: FindingDraft) => Promise<void>;
  /** Logger namespaced with the module id. */
  readonly logger: Logger;
  /** Module-scoped settings with defaults (stored under modules.<id>). */
  readonly settings: {
    get<K extends string>(key: K): Promise<unknown>;
    set<K extends string>(key: K, value: unknown): Promise<void>;
  };
}

/** Normalized finding draft — the common output currency of all modules. */
export interface FindingDraft {
  /** Module that produced the finding. */
  source: ModuleId;
  /** Machine-readable finding type, e.g. 'query-param' | 'postmessage-no-origin-check'. */
  type: string;
  /** Severity for prioritization (informational findings are valid here — triage is human). */
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  /** Short human title. */
  title: string;
  /** URL / location the finding relates to. */
  location: string;
  /** Arbitrary structured payload (typed per finding type by consumers). */
  detail: Record<string, unknown>;
  /** RFC 3339 creation time. */
  observedAt: string;
  /** Tab the finding was observed in (if any). */
  tabId?: number;
  /**
   * Optional dedup identity: rows with the same key merge (occurrences++)
   * instead of duplicating. Defaults to source|type|location|detail.
   */
  dedupeKey?: string;
}

/** Minimal logger interface (console-backed in dev, buffered in prod). */
export interface Logger {
  debug(msg: string, ...meta: unknown[]): void;
  info(msg: string, ...meta: unknown[]): void;
  warn(msg: string, ...meta: unknown[]): void;
  error(msg: string, ...meta: unknown[]): void;
}

/**
 * Engine-level events. Typed keys keep subscriptions type-safe and give
 * every module a stable vocabulary for cross-module data flow.
 */
export interface EngineEvents {
  /** A normalized finding entered the pipeline. */
  'finding:new': FindingDraft;
  /** Engine started (also fires after every SW restart — see lifecycle docs). */
  'engine:started': { reason: 'install' | 'startup' | 'restart' };
  /** Engine is stopping (SW about to suspend). */
  'engine:stopping': { reason: 'suspend' | 'shutdown' };
  /** Active tab changed (drives per-tab module state). */
  'tab:activated': { tabId: number };
}
