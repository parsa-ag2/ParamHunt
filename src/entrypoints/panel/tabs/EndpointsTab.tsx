import React, { useEffect, useMemo, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { EndpointRecord, EndpointCategory } from '@shared/types/http';
import { CopyButton, Empty, Toast, useCopyFlash } from '../ui';

/**
 * Endpoints — real endpoint discovery results: source-code + network
 * evidence, expandable to exact discovery locations. All data comes from
 * the endpoints catalog; nothing is fabricated.
 */

const CATEGORIES = ['all', 'API', 'AUTH', 'USER', 'ADMIN', 'UPLOAD', 'DOWNLOAD', 'PAYMENT', 'GRAPHQL', 'WEBSOCKET', 'ROUTE', 'OTHER'] as const;
const METHODS = ['all', 'GET', 'POST', 'PUT', 'DELETE', 'UNKNOWN'] as const;
const MAX_RENDER_ROWS = 300;

export default function EndpointsTab({ origin }: { origin: string }) {
  const [endpoints, setEndpoints] = useState<EndpointRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState<'all' | EndpointCategory>('all');
  const [method, setMethod] = useState<string>('all');
  const [sourceF, setSourceF] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [flash, copyError, doCopy] = useCopyFlash();

  const refresh = (o: string) => {
    void sendRequest<{ endpoints: EndpointRecord[]; total: number }>({
      type: 'endpoints/query',
      ...(o ? { origin: o } : {}),
    })
      .then((r) => {
        setEndpoints(r.endpoints);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => refresh(origin), [origin]);

  // LIVE SYNC: new endpoint catalog data refreshes the view
  useEffect(() => {
    const onChanged = (msg: unknown) => {
      const t = (msg as { type?: string })?.type;
      if (t === 'catalog/changed' || t === 'findings/changed') refresh(origin);
    };
    chrome.runtime.onMessage.addListener(onChanged);
    return () => chrome.runtime.onMessage.removeListener(onChanged);
  }, [origin]);

  const rows = useMemo(() => {
    let list = endpoints ?? [];
    if (category !== 'all') list = list.filter((e) => e.category === category);
    if (method !== 'all') list = list.filter((e) => e.method === method);
    if (sourceF !== 'all') list = list.filter((e) => (e.sources ?? []).includes(sourceF as never));
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (e) => e.path.toLowerCase().includes(needle) || e.url.toLowerCase().includes(needle) || e.paramNames.some((p) => p.toLowerCase().includes(needle)),
    );
  }, [endpoints, filter, category, method]);

  return (
    <div className="flex h-full flex-col">
      <Toast error={error ?? copyError} message={null} />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-700 px-3 py-1.5">
        <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-300 outline-none">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>Category: {c}</option>
          ))}
        </select>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-300 outline-none">
          {METHODS.map((m) => (
            <option key={m} value={m}>Method: {m}</option>
          ))}
        </select>
        <select value={sourceF} onChange={(e) => setSourceF(e.target.value)} className="rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-300 outline-none">
          <option value="all">Source: All</option>
          <option value="js-bundle">JS Bundle</option>
          <option value="inline-js">Inline JS</option>
          <option value="axios">Axios</option>
          <option value="fetch">Fetch</option>
          <option value="xhr">XHR</option>
          <option value="network">Network</option>
          <option value="config">Config</option>
          <option value="router">Router</option>
        </select>
        <span className="ml-auto text-xs text-slate-400">{endpoints ? `${rows.length} endpoints` : '…'}</span>
      </div>
      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search endpoints…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-sky-600"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {endpoints === null ? (
          <Empty label="Loading…" />
        ) : rows.length === 0 ? (
          <Empty
            label={
              (endpoints?.length ?? 0) === 0
                ? 'No endpoints discovered yet.\nEndpoints are mined automatically from first-party JavaScript,\ninline scripts, and observed network requests.'
                : 'No endpoints match the current filters.'
            }
          />
        ) : (
          <>
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-800 text-slate-400">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Method</th>
                  <th className="px-2 py-1.5 font-medium">Endpoint</th>
                  <th className="px-2 py-1.5 font-medium">Category</th>
                  <th className="px-2 py-1.5 font-medium">Source</th>
                  <th className="px-2 py-1.5 font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, MAX_RENDER_ROWS).map((e) => {
                  const open = expanded === e.key;
                  const ev = e.evidence[0];
                  return (
                    <React.Fragment key={e.key}>
                      <tr
                        onClick={() => setExpanded(open ? null : e.key)}
                        className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/60"
                      >
                        <td className="px-3 py-1.5">
                          <span
                            className={`rounded px-1 text-[10px] ${
                              e.method === 'UNKNOWN'
                                ? 'bg-slate-500/15 text-slate-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            {e.method}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-sky-300">
                          <span className="block max-w-72 truncate" title={e.url || e.path}>
                            {e.path}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">{e.category}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="block max-w-48 truncate text-[10px] text-slate-400" title={ev?.url ?? ''}>
                            {ev ? `${(ev.url ?? '').split('/').pop()}${ev.line ? `:${ev.line}` : ''}` : e.sources.join(', ')}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`rounded px-1 text-[10px] ${
                              e.methodConfidence === 'explicit'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : e.methodConfidence === 'inferred'
                                  ? 'bg-amber-500/15 text-amber-300'
                                  : 'bg-slate-500/15 text-slate-300'
                            }`}
                          >
                            {e.methodConfidence}
                          </span>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t border-slate-800 bg-slate-800/40">
                          <td colSpan={5} className="px-3 py-2">
                            <div className="space-y-1.5 text-[11px] text-slate-300">
                              {e.url && (
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-500">URL</span>
                                  <span className="truncate font-mono text-sky-300" title={e.url}>
                                    {e.url}
                                  </span>
                                  <CopyButton
                                    onCopy={() => void doCopy(e.url, `u-${e.key}`)}
                                    flashKey={`u-${e.key}`}
                                    flash={flash}
                                    label="Copy URL"
                                  />
                                </div>
                              )}
                              {e.paramNames.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="text-slate-500">params:</span>
                                  {e.paramNames.map((p) => (
                                    <span key={p} className="rounded bg-slate-700 px-1 font-mono text-[10px]">
                                      {p}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="space-y-1">
                                <div className="text-[10px] uppercase text-slate-500">
                                  Found At — {e.evidence.length} location(s)
                                </div>
                                {e.evidence.map((ev, i) => (
                                  <div key={`${ev.url}-${i}`} className="rounded bg-slate-900 p-1.5">
                                    <div className="flex items-center gap-2 text-[10px]">
                                      <span className="truncate font-mono text-sky-300" title={ev.url}>
                                        {ev.url ?? '—'}
                                      </span>
                                      {ev.line != null && (
                                        <span className="text-slate-400">
                                          Line {ev.line}
                                          {ev.column != null ? `, Column ${ev.column}` : ''}
                                        </span>
                                      )}
                                    </div>
                                    {ev.snippet && (
                                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-1 font-mono text-[10px] text-emerald-300">
                                        {ev.snippet}
                                      </pre>
                                    )}
                                  </div>
                                ))}
                              </div>
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-[10px] text-slate-500">
                                  sources: {e.sources.join(', ')} · ×{e.occurrences} · first seen{' '}
                                  {new Date(e.firstSeenAt).toLocaleString()}
                                </span>
                              </div>
                            </div>
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
