/**
 * modules/results-manager — the findings authority (background).
 *
 * Implements the central pipeline: recordFinding → store (dedup by hash,
 * rotation) and serves the findings/* messages to every UI context.
 */
import type {
  MessagePayloads,
  ParamHuntMessage,
} from '@core/messaging/protocol';
import type { FindingDraft, ModuleDefinition } from '@shared/types/module';
import { FindingsStore } from '@core/results/store';
import { broadcastEvent } from '@core/messaging/bridge';
import { STORAGE_KEYS } from '@shared/constants';
import type { StorageAdapter } from '@core/storage/StorageAdapter';

/** chrome.runtime.MessageSender via the global chrome types (@types/chrome). */
type MessageSender = chrome.runtime.MessageSender;

/** Typed handler map: one entry per message type this module serves. */
export type RequestHandlers = {
  [K in ParamHuntMessage['type']]?: (
    msg: Extract<ParamHuntMessage, { type: K }>,
    sender: MessageSender,
  ) => Promise<MessagePayloads[K]>;
};

export function createResultsManager(storage: StorageAdapter): {
  module: ModuleDefinition;
  handlers: RequestHandlers;
  api: { add: (draft: FindingDraft) => Promise<{ duplicate: boolean }> };
} {
  const store = new FindingsStore(storage, STORAGE_KEYS.findings);

  async function countChanged(): Promise<void> {
    broadcastEvent({ type: 'findings/changed' });
  }

  const module: ModuleDefinition = {
    id: 'results-manager',
    name: 'Results Manager',
    description: 'Central findings store: dedup, persistence, queries.',
    contexts: ['background'],
    requiredApis: ['storage'],
    dependencies: [],
    async start(ctx) {
      // warm the cache so the first UI query after an SW restart is fast
      await store.list({ limit: 0 });
      ctx.logger.info('findings store ready');
    },
  };

  const handlers: RequestHandlers = {
    'findings/query': async (msg) => store.list(msg.query),
    'findings/status': async (msg) => {
      const updated = await store.setStatus(msg.ids, msg.status);
      if (updated > 0) await countChanged();
      return { updated };
    },
    'findings/remove': async (msg) => {
      const removed = await store.remove(msg.ids);
      if (removed > 0) await countChanged();
      return { removed };
    },
    'findings/clear': async () => {
      const cleared = await store.clear();
      await countChanged();
      return { cleared };
    },
    'findings/note': async (msg) => {
      const updated = await store.setNote(msg.id, msg.note);
      if (updated > 0) await countChanged();
      return { updated };
    },
  };

  /** Exposed for the param-discovery module (single pipeline, no direct UI writes). */
  const api = {
    add: (draft: FindingDraft): Promise<{ duplicate: boolean }> => store.add(draft).then((r) => ({ duplicate: r.duplicate })),
  };

  return { module, handlers, api };
}

export type ResultsManager = ReturnType<typeof createResultsManager>;
