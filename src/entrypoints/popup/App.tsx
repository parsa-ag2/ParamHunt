import React, { useCallback, useEffect, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { ScopeView } from '@core/messaging/protocol';
import type { FindingPage } from '@shared/types/finding';
import { copyText } from '@shared/clipboard';
import { namesToClipboardText, paramName, uniqueParamNames } from '@modules/param-discovery/lib/format';

/**
 * Popup — compact summary for the site the user is browsing:
 * scope indicator, discovered-parameter count + preview, Copy All.
 * Internal engine/module details live in the DevTools panel, not here.
 */

const PREVIEW_COUNT = 8;

export default function App() {
  const [page, setPage] = useState<FindingPage | null>(null);
  const [scope, setScope] = useState<ScopeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  const [copyFail, setCopyFail] = useState(false);

  const load = useCallback(async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab?.id == null) return;
      const [findings, scopeView] = await Promise.all([
        sendRequest<FindingPage>({
          type: 'findings/query',
          query: { sources: ['param-discovery'], limit: 1000 },
        }),
        sendRequest<ScopeView>({ type: 'scope/get', tabId: tab.id }),
      ]);
      setScope(scopeView);
      // site-scoped: parameters first seen on this tab's origin
      const siteItems = findings.items.filter((f) => f.location.startsWith(scopeView.origin));
      setPage({ ...findings, items: siteItems, total: siteItems.length });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const onChanged = (msg: unknown) => {
      if ((msg as { type?: string })?.type === 'findings/changed') void load();
    };
    chrome.runtime.onMessage.addListener(onChanged);
    return () => chrome.runtime.onMessage.removeListener(onChanged);
  }, [load]);

  const copyAll = useCallback(async () => {
    if (!page) return;
    const ok = await copyText(namesToClipboardText(uniqueParamNames(page.items)));
    if (ok) {
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1200);
    } else {
      setCopyFail(true);
      setTimeout(() => setCopyFail(false), 2500);
    }
  }, [page]);

  const preview = (page?.items ?? []).slice(0, PREVIEW_COUNT).map(paramName);

  return (
    <main className="w-80 space-y-2.5 bg-slate-900 p-3 text-sm text-slate-200">
      <header className="flex items-center gap-2">
        <img src="/icons/icon-32.png" alt="" className="h-5 w-5 rounded" />
        <h1 className="text-base font-semibold text-slate-100">ParamHunt</h1>
        <span className="rounded bg-slate-700 px-1.5 text-[10px] uppercase text-slate-300">v0.2.0</span>
      </header>

      {error && <p className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">{error}</p>}

      {scope && (
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-1.5 text-[10px] font-medium uppercase ${
              scope.inScope ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
            }`}
            title={`scope: ${scope.reason} — configure in Options`}
          >
            {scope.inScope ? 'in scope' : 'out of scope'}
          </span>
          <span className="truncate text-xs text-slate-400" title={scope.origin}>
            {scope.origin || 'no tab URL'}
          </span>
        </div>
      )}

      <section className="rounded bg-slate-800 p-2">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase text-slate-500">Discovered parameters</div>
            <div className="text-2xl font-semibold text-sky-300">{page ? page.total : '…'}</div>
          </div>
          <button
            onClick={() => void copyAll()}
            disabled={!page || page.total === 0}
            className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {copyOk ? '✓ Copied' : copyFail ? 'Copy failed' : 'Copy All'}
          </button>
        </div>

        {preview.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-slate-300">
            {preview.map((n, i) => (
              <li key={`${n}-${i}`} className="truncate" title={n}>
                {n}
              </li>
            ))}
            {page && page.total > PREVIEW_COUNT && (
              <li className="text-slate-500">… and {page.total - PREVIEW_COUNT} more</li>
            )}
          </ul>
        )}
      </section>

      <p className="text-center text-[10px] text-slate-500">
        Full toolkit: DevTools (F12) → <span className="text-slate-300">ParamHunt</span> tab
      </p>
    </main>
  );
}
