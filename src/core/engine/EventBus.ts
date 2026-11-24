/**
 * core/engine/EventBus.ts — typed in-context pub/sub.
 *
 * IMPORTANT ARCHITECTURE FACT: this bus works ONLY inside a single JS
 * context (a service worker OR one content script world). Cross-context
 * flow goes through the messaging bridge (core/messaging) — the bus never
 * crosses context boundaries. See docs/ARCHITECTURE.md.
 */
import type { EngineEvents } from '@shared/types/module';

type Handler<E extends keyof EngineEvents> = (payload: EngineEvents[E]) => void;

export class EventBus {
  private readonly handlers = new Map<keyof EngineEvents, Set<Handler<never>>>();

  on<E extends keyof EngineEvents>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<E extends keyof EngineEvents>(event: E, payload: EngineEvents[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Snapshot: a handler may unsubscribe during dispatch.
    for (const handler of [...set]) {
      (handler as unknown as Handler<E>)(payload);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
