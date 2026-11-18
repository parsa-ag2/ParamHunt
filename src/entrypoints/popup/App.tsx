import React, { useEffect, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { ScopeView } from '@core/messaging/protocol';
import type { FindingQuery } from '@shared/types/finding';

/** Popup — real status board: scope of the active tab, live counters, module status. */

interface EngineStatus {
  running: boolean;
  modules: { id: string; status: string }[];
}

const PLANNED: readonly string[] = [
  'dom-inspector',
  'postmessage-tracker',
  'js-analyzer',
  'http-analyzer',
  'event-monitor',
  'storage-inspector',
  'export-engine',
];

export default function App() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [scope, setScope] = useState<ScopeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [tabs, engineStatus, findings] = await Promise.all([
          chrome.tabs.query({ active: true, currentWindow: true }),
          sendRequest<EngineStatus>({ type: 'engine/status' }),
          sendRequest<{ total: number }>({
            type: 'findings/query',
            query: { sources: ['param-discovery'], limit: 0 } as FindingQuery,
          }),
        ]);
        const tab = tabs[0];
        setStatus(engineStatus);
        setTotal(findings.total);
        if (tab?.id != null) {
          setScope(await sendRequest<ScopeView>({ type: 'scope/get', tabId: tab.id }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  return (
    <main className="w-80 space-y-3 bg-slate-900 p-3 text-sm text-slate-200">
      <header className="flex items-center gap-2">
        <h1 className="text-base font-semibold text-slate-100">ParamHunt</h1>
        <span className="rounded bg-slate-700 px-1.5 text-[10px] uppercase text-slate-300">v0.1.0</span>
      </header>

      {error && <p className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">{error}</p>}

      <section className="rounded bg-slate-800 p-2">
        <div className="mb-1 text-[10px] font-medium uppercase text-slate-500">Active tab scope</div>
        {scope ? (
          <div className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 text-[10px] font-medium uppercase ${
                scope.inScope ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
              }`}
            >
              {scope.inScope ? 'in scope' : 'out of scope'}
            </span>
            <span className="truncate text-xs text-slate-400" title={scope.origin}>
              {scope.origin || 'no tab'}
            </span>
          </div>
        ) : (
          <p className="text-xs text-slate-500">…</p>
        )}
      </section>

      <section className="rounded bg-slate-800 p-2">
        <div className="mb-1 text-[10px] font-medium uppercase text-slate-500">Discovered parameters</div>
        <div className="text-2xl font-semibold text-sky-300">{total ?? '…'}</div>
        <p className="mt-0.5 text-[10px] text-slate-500">
          Open DevTools (F12) → ParamHunt panel to browse them.
        </p>
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

      <section className="rounded bg-slate-800 p-2">
        <div className="mb-1 text-[10px] font-medium uppercase text-slate-500">Planned modules</div>
        <p className="text-[11px] leading-4 text-slate-500">{PLANNED.join(' · ')}</p>
      </section>
    </main>
  );
}
