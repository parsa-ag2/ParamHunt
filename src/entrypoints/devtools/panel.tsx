import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { ScopeView } from '@core/messaging/protocol';
import type { Finding, FindingPage } from '@shared/types/finding';
import { copyText } from '@shared/clipboard';
import { namesToClipboardText, paramName, uniqueParamNames } from '@modules/param-discovery/lib/format';

/**
 * DevTools panel — the ParamHunt workbench.
 *
 * Site-scoped live view of discovered parameters (findings of source
 * param-discovery whose location belongs to the inspected tab's origin).
 * Every number comes from the findings store; empty states explain why.
 */

const SOURCE_FILTERS = ['all', 'url', 'dom', 'form', 'js'] as const;
type SourceFilter = (typeof SOURCE_FILTERS)[number];

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
type SortMode = 'recent' | 'occurrences' | 'name';

/** Never render more rows than this — keep the panel responsive. */
const MAX_RENDER_ROWS = 300;

export default function Panel() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [page, setPage] = useState<FindingPage | null>(null);
  const [scope, setScope] = useState<ScopeView | null>(null);
  const [filter, setFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copiedFlash, setCopiedFlash] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  /** Latest origin for the change-listener without re-subscribing. */
  const originRef = useRef('');

  const refresh = useCallback(async (tid: number, siteOrigin: string) => {
    try {
      const query = {
        sources: ['param-discovery'] as const,
        // site-scoped: only parameters first seen on this tab's origin
        ...(siteOrigin ? { locationIncludes: siteOrigin } : {}),
        limit: 1000,
      };
      const findings = await sendRequest<FindingPage>({ type: 'findings/query', query });
      setPage(findings);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    originRef.current = scope?.origin ?? '';
  }, [scope?.origin]);

  useEffect(() => {
    const tid = chrome.devtools.inspectedWindow.tabId;
    setTabId(tid);
    void (async () => {
      try {
        const scopeView = await sendRequest<ScopeView>({ type: 'scope/get', tabId: tid });
        setScope(scopeView);
        originRef.current = scopeView.origin;
        await refresh(tid, scopeView.origin);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    const onChanged = (msg: unknown) => {
      if ((msg as { type?: string })?.type === 'findings/changed') {
        void refresh(tid, originRef.current);
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
      const r = await sendRequest<{ status: string; observations: number; stored: number; duplicates: number; error?: string }>({
        type: 'scan/trigger',
        tabId,
      });
      if (r.status === 'failed') {
        setScanMsg(`Scan failed: ${r.error ?? 'unknown error'}`);
        setScanState('error');
        return;
      }
      if (r.status === 'injected') {
        setScanMsg('Content script was injected into this tab — collecting…');
      } else if (r.status === 'out-of-scope') {
        setScanMsg('This tab is out of scope (see Options).');
      } else {
        setScanMsg(`${r.observations} params · ${r.stored} new, ${r.duplicates} known`);
      }
      setScanState('idle');
      void refresh(tabId, scope?.origin ?? '');
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : String(err));
      setScanState('error');
    }
  }, [tabId, refresh, scope?.origin]);

  const clearAll = useCallback(async () => {
    if (!confirm('Remove all discovered parameters for this site?')) return;
    await sendRequest({ type: 'findings/clear' });
    if (tabId != null) void refresh(tabId, scope?.origin ?? '');
  }, [tabId, refresh, scope?.origin]);

  const rows = useMemo(() => {
    const items = page?.items ?? [];
    let out = items;
    if (sourceFilter !== 'all') {
      out = out.filter((f) => {
        const sources = (f.detail as Record<string, unknown>)?.sources as Record<string, number> | undefined;
        return sources ? Object.keys(sources).includes(sourceFilter) : false;
      });
    }
    const needle = filter.trim().toLowerCase();
    if (needle) out = out.filter((f) => paramName(f).toLowerCase().includes(needle));
    const sorted = [...out];
    if (sortMode === 'name') sorted.sort((a, b) => paramName(a).localeCompare(paramName(b)));
    else if (sortMode === 'occurrences') sorted.sort((a, b) => b.occurrences - a.occurrences);
    // 'recent' is the store's default order (lastSeenAt desc)
    return sorted;
  }, [page, filter, sourceFilter, sortMode]);

  const visibleRows = rows.slice(0, MAX_RENDER_ROWS);
  const allNames = useMemo(() => uniqueParamNames(rows), [rows]);

  const doCopy = useCallback(
    async (text: string, flashKey: string) => {
      const ok = await copyText(text);
      if (ok) {
        setCopyError(null);
        setCopiedFlash(flashKey);
        setTimeout(() => setCopiedFlash((c) => (c === flashKey ? null : c)), 1200);
      } else {
        setCopyError('Clipboard copy failed — select the text manually.');
        setTimeout(() => setCopyError(null), 3000);
      }
      return ok;
    },
    [],
  );

  const copyRow = useCallback(
    async (f: Finding) => doCopy(paramName(f), f.id),
    [doCopy],
  );
  const copyAll = useCallback(
    async () => doCopy(namesToClipboardText(allNames), '__all__'),
    [doCopy, allNames],
  );
  const copySelected = useCallback(async () => {
    const chosen = rows.filter((f) => selected.has(f.id));
    await doCopy(namesToClipboardText(uniqueParamNames(chosen)), '__selected__');
  }, [rows, selected, doCopy]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-200">
      {/* header */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-3 py-2">
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
        <span className="ml-auto text-xs text-slate-400">
          {page ? `${rows.length} of ${page.total} params` : '…'}
        </span>
        <button
          onClick={() => void copyAll()}
          disabled={allNames.length === 0}
          className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {copiedFlash === '__all__' ? '✓ Copied' : `Copy All (${allNames.length})`}
        </button>
        <button
          onClick={() => void copySelected()}
          disabled={selected.size === 0}
          className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
        >
          {copiedFlash === '__selected__' ? '✓ Copied' : `Copy Selected (${selected.size})`}
        </button>
        <button
          onClick={() => void rescan()}
          disabled={scanState === 'scanning' || (scope != null && !scope.inScope)}
          className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
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

      {/* source filter chips + sort */}
      <div className="flex items-center gap-1.5 border-b border-slate-700 px-3 py-1.5">
        {SOURCE_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setSourceFilter(s)}
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
              sourceFilter === s ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {s === 'all' ? 'all sources' : s}
          </button>
        ))}
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 outline-none"
        >
          <option value="recent">sort: recent</option>
          <option value="occurrences">sort: occurrences</option>
          <option value="name">sort: name</option>
        </select>
      </div>

      {scanMsg && (
        <div
          className={`px-3 py-1 text-xs ${
            scanState === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {scanMsg}
        </div>
      )}
      {copyError && <div className="bg-red-500/10 px-3 py-1 text-xs text-red-300">{copyError}</div>}
      {loadError && (
        <div className="bg-red-500/10 px-3 py-1 text-xs text-red-300">store error: {loadError}</div>
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
        {scope && !scope.inScope ? (
          <Empty label={'This tab is out of scope.\nParamHunt observes only the current origin (or allowlisted origins).\nConfigure scope in Options.'} />
        ) : page === null ? (
          <Empty label="Loading findings…" />
        ) : rows.length === 0 ? (
          <Empty
            label={
              page.total === 0
                ? 'No parameters discovered for this site yet.\nBrowse the target site, or press Rescan — if the tab was\nopened before the extension was loaded, Rescan injects the collector automatically.'
                : 'No parameters match the current filter.'
            }
          />
        ) : (
          <>
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-800 text-slate-400">
                <tr>
                  <th className="w-6 px-2 py-1.5" aria-label="select" />
                  <th className="px-2 py-1.5 font-medium">Parameter</th>
                  <th className="px-2 py-1.5 font-medium">Sources</th>
                  <th className="px-2 py-1.5 font-medium">Method</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">×Seen</th>
                  <th className="px-2 py-1.5 font-medium">Confidence</th>
                  <th className="w-10 px-2 py-1.5" aria-label="copy" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((f) => {
                  const d = f.detail as Record<string, unknown>;
                  const sources = (d.sources ?? {}) as Record<string, number>;
                  const kinds = (d.kinds ?? []) as string[];
                  const methods = ((d.methods ?? []) as string[]).join(', ');
                  const inputTypes = ((d.inputTypes ?? []) as string[]).join(', ');
                  const name = paramName(f);
                  const open = expanded === f.id;
                  return (
                    <React.Fragment key={f.id}>
                      <tr
                        onClick={() => setExpanded(open ? null : f.id)}
                        className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/60"
                      >
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(f.id)}
                            onChange={() => toggleSelect(f.id)}
                            className="accent-sky-500"
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono text-sky-300">{name}</td>
                        <td className="px-2 py-1.5">
                          <span className="flex gap-1">
                            {Object.keys(sources).map((s) => (
                              <span key={s} className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">
                                {sourceLabel[s] ?? s}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-slate-400">{methods || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-400">{inputTypes || (kinds[0] ?? '—')}</td>
                        <td className="px-2 py-1.5 text-slate-300">{f.occurrences > 1 ? `×${f.occurrences}` : '×1'}</td>
                        <td className="px-2 py-1.5">
                          <span className={`rounded px-1 text-[10px] ${confidenceStyle[(d.confidence as string) ?? 'low'] ?? ''}`}>
                            {(d.confidence as string) ?? 'low'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => void copyRow(f)}
                            title={`Copy "${name}"`}
                            className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200 hover:bg-slate-600"
                          >
                            {copiedFlash === f.id ? '✓' : 'Copy'}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t border-slate-800 bg-slate-800/40">
                          <td colSpan={8} className="px-3 py-2">
                            <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1 text-[11px] text-slate-300">
                              <dt className="text-slate-500">kinds</dt>
                              <dd>{kinds.join(', ') || '—'}</dd>
                              <dt className="text-slate-500">first page</dt>
                              <dd className="break-all font-mono">{String(d.firstPageUrl ?? '—')}</dd>
                              <dt className="text-slate-500">last page</dt>
                              <dd className="break-all font-mono">{String(d.lastPageUrl ?? '—')}</dd>
                              <dt className="text-slate-500">sample</dt>
                              <dd className="break-all font-mono">{String(d.firstSample ?? '—')}</dd>
                              <dt className="text-slate-500">first seen</dt>
                              <dd>{new Date(f.firstSeenAt).toLocaleString()}</dd>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {rows.length > MAX_RENDER_ROWS && (
              <div className="px-3 py-2 text-[11px] text-slate-500">
                Showing {MAX_RENDER_ROWS} of {rows.length} — refine the filter to narrow the list.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs whitespace-pre-line text-slate-500">
      {label}
    </div>
  );
}
