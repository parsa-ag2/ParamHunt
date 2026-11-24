import React, { useMemo, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { UrlRecord } from '@shared/types/http';
import { maskUrl, urlForCopy } from '@shared/mask';
import { CopyButton, Empty, Toast, useCopyFlash } from '../ui';

/** URL Explorer — catalog of observed URLs, live-synced, with working selection. */
export default function UrlsTab({ origin }: { origin: string }) {
  const [urls, setUrls] = useState<UrlRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [methodF, setMethodF] = useState<'all' | 'GET' | 'POST' | 'OTHER'>('all');
  const [sourceF, setSourceF] = useState<'all' | string>('all');
  const [showValues, setShowValues] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [flash, copyError, doCopy] = useCopyFlash();

  const refresh = (o: string) => {
    void sendRequest<{ urls: UrlRecord[]; total: number }>({
      type: 'urls/query',
      ...(o ? { origin: o } : {}),
    })
      .then((r) => {
        setUrls(r.urls);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => refresh(origin), [origin]);

  // LIVE SYNC: new catalog data refreshes the view (coalesced broadcast)
  useEffect(() => {
    const onChanged = (msg: unknown) => {
      const t = (msg as { type?: string })?.type;
      if (t === 'catalog/changed' || t === 'findings/changed') refresh(origin);
    };
    chrome.runtime.onMessage.addListener(onChanged);
    return () => chrome.runtime.onMessage.removeListener(onChanged);
  }, [origin]);

  const rows = useMemo(() => {
    let list = urls ?? [];
    if (methodF !== 'all') list = list.filter((u) => u.method === methodF);
    if (sourceF !== 'all') list = list.filter((u) => (u.sources ?? []).includes(sourceF as never));
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (u) => u.url.toLowerCase().includes(needle) || u.paramNames.some((p) => p.toLowerCase().includes(needle)),
    );
  }, [urls, filter, methodF, sourceF]);

  const toggleSelect = (url: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(url) ? n.delete(url) : n.add(url);
      return n;
    });

  const copyUrl = (u: UrlRecord) => doCopy(urlForCopy(u.url, { includeValues: showValues }), `u-${u.url}`);
  const copyPath = (u: UrlRecord) => doCopy(u.path, `p-${u.url}`);
  const copyQuery = (u: UrlRecord) => {
    try {
      const q = new URL(u.url).search.replace(/^\?/, '');
      void doCopy(q, `q-${u.url}`);
    } catch {
      void doCopy('', `q-${u.url}`);
    }
  };
  const copyNames = (u: UrlRecord) => void doCopy(u.paramNames.join('\n'), `n-${u.url}`);

  return (
    <div className="flex h-full flex-col">
      <Toast error={error ?? copyError} message={null} />
      {/* compact toolbar: search + dropdowns + values toggle */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-700 px-3 py-1.5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search URLs or parameters…"
          className="min-w-40 flex-1 rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-sky-600"
        />
        <select
          value={sourceF}
          onChange={(e) => setSourceF(e.target.value)}
          className="rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-300 outline-none"
        >
          <option value="all">Source: All</option>
          <option value="page">Page</option>
          <option value="link">Link</option>
          <option value="form">Form</option>
          <option value="script">Script</option>
          <option value="inline-js">Inline JS</option>
          <option value="js-bundle">JS Bundle</option>
          <option value="network">Network</option>
          <option value="meta">Meta</option>
          <option value="embed">Embed</option>
        </select>
        <select
          value={methodF}
          onChange={(e) => setMethodF(e.target.value as typeof methodF)}
          className="rounded bg-slate-800 px-1.5 py-1 text-[10px] text-slate-300 outline-none"
        >
          <option value="all">Method: All</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="OTHER">Other</option>
        </select>
        <CopyButton
          onCopy={() =>
            void doCopy(
              rows.filter((u) => selected.has(u.url)).map((u) => urlForCopy(u.url, { includeValues: showValues })).join('\n'),
              '__selurls__',
            )
          }
          flashKey="__selurls__"
          flash={flash}
          label={`Copy Selected (${selected.size})`}
          disabled={selected.size === 0}
        />
        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          <input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} className="accent-sky-500" />
          include values
        </label>
        <span className="text-xs text-slate-400">{urls ? `${rows.length} URLs` : '…'}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {urls === null ? (
          <Empty label="Loading…" />
        ) : rows.length === 0 ? (
          <Empty
            label={
              (urls?.length ?? 0) === 0
                ? 'No URLs observed for this site yet.\nBrowse the site — links, form actions, scripts, embeds\nand network requests are cataloged automatically.'
                : 'No URLs match the current filters.'
            }
          />
        ) : (
          <ul className="text-xs">
            {rows.map((u) => {
              const display = maskUrl(u.url);
              const open = expanded === u.url;
              return (
                <li key={u.url} className="border-t border-slate-800">
                  <div
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-800/60"
                    onClick={() => setExpanded(open ? null : u.url)}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(u.url)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(u.url)}
                      className="accent-sky-500"
                    />
                    <SourceBadge source={(u.sources ?? [])[0] ?? 'other'} />
                    <span className="truncate font-mono text-slate-300" title={u.url}>
                      <span className="text-slate-500">{u.origin}</span>
                      {display.slice(u.origin.length)}
                    </span>
                    <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {(u.sources ?? []).length > 1 && <Badge tone="info">+{u.sources.length - 1}</Badge>}
                      <Badge tone="info">{u.method}</Badge>
                      <Badge tone="info">×{u.occurrences}</Badge>
                      <CopyButton onCopy={() => void copyUrl(u)} flashKey={`u-${u.url}`} flash={flash} label="Copy URL" />
                    </span>
                  </div>
                  {open && (
                    <div className="bg-slate-800/40 px-3 py-2">
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        <CopyButton onCopy={() => void copyPath(u)} flashKey={`p-${u.url}`} flash={flash} label="Copy path" />
                        <CopyButton onCopy={() => void copyQuery(u)} flashKey={`q-${u.url}`} flash={flash} label="Copy query string" />
                        <CopyButton onCopy={() => void copyNames(u)} flashKey={`n-${u.url}`} flash={flash} label="Copy param names" />
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {u.paramNames.length > 0 ? (
                          <ul className="space-y-0.5">
                            {u.paramNames.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-slate-500">no query parameters</span>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'ok' | 'bad' | 'warn' | 'info'; children: React.ReactNode }) {
  const tones = {
    ok: 'bg-emerald-500/15 text-emerald-300',
    bad: 'bg-red-500/15 text-red-300',
    warn: 'bg-amber-500/15 text-amber-300',
    info: 'bg-slate-500/15 text-slate-300',
  };
  return <span className={`rounded px-1 text-[10px] ${tones[tone]}`}>{children}</span>;
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">
      {source === 'network' ? 'NET' : source === 'link' ? 'LINK' : source === 'form' ? 'FORM' : source === 'script' ? 'SCRIPT' : source.toUpperCase().slice(0, 6)}
    </span>
  );
}
