import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { ScopeView } from '@core/messaging/protocol';
import type { FindingPage, Finding } from '@shared/types/finding';

/**
 * DevTools panel — the ParamHunt workbench.
 * Live view of discovered parameters for the inspected tab (source:
 * param-discovery findings). Real data only: every number comes from the
 * findings store; empty states are explicit.
 */

const sourceLabel: Record<string, string> = {
  url: 'URL',
  form: 'FORM',
  dom: 'DOM',
  js: 'JS',
};

const confidenceStyle: Record<string, string> = {
  high: 'bg-emerald-500/15 text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-300',
  low: 'bg-slate-500/15 text-slate-300',
};

type ScanState = 'idle' | 'scanning' | 'error';

export default function Panel() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [page, setPage] = useState<FindingPage | null>(null);
  const [scope, setScope] = useState<ScopeView | null>(null);
  const [filter, setFilter] = useState('');
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async (tid: number) => {
    try {
      const [findings, scopeView] = await Promise.all([
        sendRequest<typeof page>({
          type: 'findings/query',
          query: { sources: ['param-discovery'], limit: 500 },
        }),
        sendRequest<ScopeView>({ type: 'scope/get', tabId: tid }),
      ]);
      setPage(findings);
      setScope(scopeView);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const tid = chrome.devtools.inspectedWindow.tabId;
    setTabId(tid);
    void refresh(tid);

    const onChanged = (msg: unknown) => {
      if ((msg as { type?: string })?.type === 'findings/changed') {
        void refresh(tid);
      }
    };
    chrome.runtime.onMessage.addListener(onChanged);
    return () => chrome.runtime.onMessage.removeListener(onChanged);
  }, [refresh]);

  const rescan = useCallback(async () => {
    if (tabId == null) return;
    setScanState('scanning');
    setScanMsg(null);
    try {
      const r = await sendRequest<{ observations: number; stored: number; duplicates: number }>({
        type: 'scan/trigger',
        tabId,
      });
      setScanMsg(`${r.observations} params · ${r.stored} new, ${r.duplicates} known`);
      setScanState('idle');
      void refresh(tabId);
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : String(err));
      setScanState('error');
    }
  }, [tabId, refresh]);

  const clearAll = useCallback(async () => {
    if (!confirm('Remove all discovered parameters?')) return;
    await sendRequest({ type: 'findings/clear' });
    if (tabId != null) void refresh(tabId);
  }, [tabId, refresh]);

  const rows = useMemo(() => {
    const items = page?.items ?? [];
    if (!filter.trim()) return items;
    const f = filter.trim().toLowerCase();
    return items.filter((it: Finding) => it.title.toLowerCase().includes(f));
  }, [page, filter]);

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-200">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-slate-700 px-3 py-2">
        <h1 className="text-sm font-semibold text-slate-100">ParamHunt</h1>
        {scope && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
              scope.inScope ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
            }`}
            title={`scope: ${scope.reason}`}
          >
            {scope.inScope ? 'in scope' : 'out of scope'}
          </span>
        )}
        {scope?.origin ? (
          <span className="truncate text-xs text-slate-400" title={scope.origin}>
            {scope.origin}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">{page ? `${page.total} params` : '…'}</span>
        <button
          onClick={() => void rescan()}
          disabled={scanState === 'scanning' || !scope?.inScope}
          className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {scanState === 'scanning' ? 'Scanning…' : 'Rescan'}
        </button>
        <button
          onClick={() => void clearAll()}
          className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
        >
          Clear
        </button>
      </header>

      {scanMsg && (
        <div
          className={`px-3 py-1 text-xs ${
            scanState === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {scanMsg}
        </div>
      )}
      {loadError && (
        <div className="bg-red-500/10 px-3 py-1 text-xs text-red-300">
          store error: {loadError}
        </div>
      )}

      {/* filter */}
      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter parameters…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-sky-600"
        />
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto">
        {page === null ? (
          <Empty label="Loading findings…" />
        ) : rows.length === 0 ? (
          <Empty
            label={
              page.total === 0
                ? 'No parameters discovered yet.\nBrowse the target site or press Rescan.'
                : 'No parameters match the filter.'
            }
          />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-800 text-slate-400">
              <tr>
                <th className="px-3 py-1.5 font-medium">Parameter</th>
                <th className="px-2 py-1.5 font-medium">Sources</th>
                <th className="px-2 py-1.5 font-medium">Confidence</th>
                <th className="px-2 py-1.5 font-medium">Seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const d = f.detail as Record<string, unknown>;
                const sources = (d.sources ?? {}) as Record<string, number>;
                const kinds = (d.kinds ?? []) as string[];
                const open = expanded === f.id;
                return (
                  <React.Fragment key={f.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : f.id)}
                      className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/60"
                    >
                      <td className="px-3 py-1.5 font-mono text-sky-300">{f.title.replace('param: ', '')}</td>
                      <td className="px-2 py-1.5">
                        <span className="flex gap-1">
                          {Object.keys(sources).map((s) => (
                            <span key={s} className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">
                              {sourceLabel[s] ?? s}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded px-1 text-[10px] ${confidenceStyle[(d.confidence as string) ?? 'low'] ?? ''}`}>
                          {(d.confidence as string) ?? 'low'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-400">
                        {f.occurrences > 1 ? `×${f.occurrences}` : ''}{' '}
                        {new Date(f.lastSeenAt).toLocaleTimeString()}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-slate-800 bg-slate-800/40">
                        <td colSpan={4} className="px-3 py-2">
                          <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1 text-[11px] text-slate-300">
                            <dt className="text-slate-500">kinds</dt>
                            <dd>{kinds.join(', ') || '—'}</dd>
                            <dt className="text-slate-500">methods</dt>
                            <dd>{((d.methods ?? []) as string[]).join(', ') || '—'}</dd>
                            <dt className="text-slate-500">input types</dt>
                            <dd>{((d.inputTypes ?? []) as string[]).join(', ') || '—'}</dd>
                            <dt className="text-slate-500">first page</dt>
                            <dd className="break-all font-mono">{String(d.firstPageUrl ?? '—')}</dd>
                            <dt className="text-slate-500">last page</dt>
                            <dd className="break-all font-mono">{String(d.lastPageUrl ?? '—')}</dd>
                            <dt className="text-slate-500">sample</dt>
                            <dd className="break-all font-mono">{String(d.firstSample ?? '—')}</dd>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-500 whitespace-pre-line">
      {label}
    </div>
  );
}
