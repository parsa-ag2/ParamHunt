import React, { useCallback, useEffect, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { ScopeView } from '@core/messaging/protocol';
import type { FindingPage } from '@shared/types/finding';
import { copyText } from '@shared/clipboard';
import { namesToClipboardText, paramName, uniqueParamNames } from '@modules/param-discovery/lib/format';

/** Popup — real data for the active tab: scope, counters, preview, copy, rescan. */

interface EngineStatus {
  running: boolean;
  modules: { id: string; status: string }[];
}

const PREVIEW_COUNT = 8;

export default function App() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [page, setPage] = useState<FindingPage | null>(null);
  const [scope, setScope] = useState<ScopeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'error'>('idle');
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  const load = useCallback(async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab?.id == null) return;
      const [engineStatus, findings, scopeView] = await Promise.all([
        sendRequest<EngineStatus>({ type: 'engine/status' }),
        sendRequest<FindingPage>({
          type: 'findings/query',
          query: { sources: ['param-discovery'], limit: 1000 },
        }),
        sendRequest<ScopeView>({ type: 'scope/get', tabId: tab.id }),
      ]);
      setStatus(engineStatus);
      setScope(scopeView);
      // site-scoped view: only parameters first seen on this tab's origin
      const sitePage = scopeView.origin
        ? {
            ...findings,
            items: findings.items.filter((f) => f.location.startsWith(scopeView.origin)),
            total: findings.items.filter((f) => f.location.startsWith(scopeView.origin)).length,
          }
        : findings;
      setPage(sitePage);
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

  const rescan = useCallback(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId == null) return;
    setScanState('scanning');
    setScanMsg(null);
    try {
      const r = await sendRequest<{ status: string; stored: number; duplicates: number; error?: string }>({
        type: 'scan/trigger',
        tabId,
      });
      if (r.status === 'failed') {
        setScanMsg(`Scan failed: ${r.error ?? 'unknown'}`);
        setScanState('error');
      } else if (r.status === 'injected') {
        setScanMsg('Collector injected into this tab — collecting…');
        setScanState('idle');
      } else if (r.status === 'out-of-scope') {
        setScanMsg('Out of scope — configure scope in Options.');
        setScanState('idle');
      } else {
        setScanMsg(`${r.stored} new, ${r.duplicates} known`);
        setScanState('idle');
      }
      void load();
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : String(err));
      setScanState('error');
    }
  }, [load]);

  const copyAll = useCallback(async () => {
    if (!page) return;
    const names = uniqueParamNames(page.items);
    const ok = await copyText(namesToClipboardText(names));
    if (ok) {
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1200);
    } else {
      setScanMsg('Clipboard copy failed.');
      setScanState('error');
    }
  }, [page]);

  const preview = (page?.items ?? []).slice(0, PREVIEW_COUNT).map(paramName);
  const lastSeen = (page?.items ?? []).reduce<string | null>(
    (max, f) => (max && max >= f.lastSeenAt ? max : f.lastSeenAt),
    null,
  );

  return (
    <main className="w-80 space-y-2.5 bg-slate-900 p-3 text-sm text-slate-200">
      <header className="flex items-center gap-2">
        <h1 className="text-base font-semibold text-slate-100">ParamHunt</h1>
        <span className="rounded bg-slate-700 px-1.5 text-[10px] uppercase text-slate-300">v0.1.0</span>
      </header>

      {error && <p className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">{error}</p>}

      <section className="rounded bg-slate-800 p-2">
        <div className="mb-1 text-[10px] font-medium uppercase text-slate-500">Active tab</div>
        {scope ? (
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 text-[10px] font-medium uppercase ${
                scope.inScope ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
              }`}
              title={`scope: ${scope.reason}`}
            >
              {scope.inScope ? 'in scope' : 'out of scope'}
            </span>
            <span className="truncate text-xs text-slate-400" title={scope.origin}>
              {scope.origin || 'no tab URL'}
            </span>
          </div>
        ) : (
          <p className="text-xs text-slate-500">…</p>
        )}
      </section>

      <section className="rounded bg-slate-800 p-2">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase text-slate-500">Discovered parameters (this site)</div>
            <div className="text-2xl font-semibold text-sky-300">{page ? page.total : '…'}</div>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => void copyAll()}
              disabled={!page || page.total === 0}
              className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {copyOk ? '✓ Copied' : 'Copy All'}
            </button>
            <button
              onClick={() => void rescan()}
              disabled={scanState === 'scanning' || (scope != null && !scope.inScope)}
              className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {scanState === 'scanning' ? '…' : 'Rescan'}
            </button>
          </div>
        </div>
        {(scanMsg || lastSeen) && (
          <p className={`mt-1 text-[10px] ${scanState === 'error' ? 'text-red-300' : 'text-slate-500'}`}>
            {scanMsg ?? (lastSeen ? `last collection: ${new Date(lastSeen).toLocaleTimeString()}` : 'no collection yet')}
          </p>
        )}
        {preview.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-slate-300">
            {preview.map((n, i) => (
              <li key={`${n}-${i}`} className="truncate" title={n}>
                {n}
              </li>
            ))}
            {page && page.total > PREVIEW_COUNT && (
              <li className="text-slate-500">… and {page.total - PREVIEW_COUNT} more (open the panel)</li>
            )}
          </ul>
        )}
      </section>

      <section className="rounded bg-slate-800 p-2">
        <div className="mb-1 text-[10px] font-medium uppercase text-slate-500">Engine</div>
        <ul className="space-y-1 text-xs">
          {(status?.modules ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between">
              <span className="text-slate-300">{m.id}</span>
              <span
                className={`rounded px-1 text-[10px] ${
                  m.status === 'started' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                }`}
              >
                {m.status}
              </span>
            </li>
          ))}
          {status === null && <li className="text-slate-500">connecting…</li>}
        </ul>
      </section>

      <p className="text-center text-[10px] text-slate-500">
        Full table: DevTools (F12) → <span className="text-slate-300">ParamHunt</span> tab
      </p>
    </main>
  );
}
