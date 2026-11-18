/**
 * entrypoints/devtools/hooks.ts — shared live-data hooks for the panel tabs.
 */
import { useCallback, useEffect, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { ScopeView } from '@core/messaging/protocol';
import type { FindingPage, FindingQuery } from '@shared/types/finding';

export function useDevtoolsTabId(): number | null {
  const [tabId, setTabId] = useState<number | null>(null);
  useEffect(() => {
    setTabId(chrome.devtools.inspectedWindow.tabId);
  }, []);
  return tabId;
}

export function useScope(tabId: number | null): ScopeView | null {
  const [scope, setScope] = useState<ScopeView | null>(null);
  useEffect(() => {
    if (tabId == null) return;
    void sendRequest<ScopeView>({ type: 'scope/get', tabId })
      .then(setScope)
      .catch(() => setScope(null));
  }, [tabId]);
  return scope;
}

/**
 * Findings for one origin, live: re-queries on `findings/changed` broadcasts.
 * `origin` scopes results to the inspected site; empty = unfiltered.
 */
export function useSiteFindings(origin: string, extra: Omit<FindingQuery, 'locationIncludes'> = {}): {
  page: FindingPage | null;
  error: string | null;
  refresh: () => void;
} {
  const [page, setPage] = useState<FindingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const query: FindingQuery = {
      ...extra,
      ...(origin ? { locationIncludes: origin } : {}),
    };
    void sendRequest<FindingPage>({ type: 'findings/query', query })
      .then((p) => {
        setPage(p);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [origin, tick, JSON.stringify(extra)]);

  useEffect(() => {
    const onChanged = (msg: unknown) => {
      if ((msg as { type?: string })?.type === 'findings/changed') setTick((t) => t + 1);
    };
    chrome.runtime.onMessage.addListener(onChanged);
    return () => chrome.runtime.onMessage.removeListener(onChanged);
  }, []);

  return { page, error, refresh };
}

/** Simple clipboard helper with user-visible result. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
