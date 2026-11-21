import React, { useEffect, useMemo, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { UrlRecord } from '@shared/types/http';
import { maskUrl, urlForCopy } from '@shared/mask';
import { CopyButton, Empty, Toast, useCopyFlash } from '../ui';

/** URL Explorer — catalog of observed URLs, expandable to parameters. */
export default function UrlsTab({ origin }: { origin: string }) {
  const [urls, setUrls] = useState<UrlRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showValues, setShowValues] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [methodF, setMethodF] = useState<'all' | 'GET' | 'POST' | 'OTHER'>('all');
  const [sourceF, setSourceF] = useState<'all' | 'page' | 'network'>('all');
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

  const rows = useMemo(() => {
    let list = urls ?? [];
    if (methodF !== 'all') list = list.filter((u) => u.method === methodF);
    if (sourceF !== 'all') list = list.filter((u) => (u.sources ?? []).includes(sourceF as never));
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((u) => u.url.toLowerCase().includes(needle) || u.paramNames.some((p) => p.toLowerCase().includes(needle)));
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
      const q = new URL(u.url, origin || undefined).search;
      doCopy(q.replace(/^\?/, ''), `q-${u.url}`);
    } catch {
      doCopy('', `q-${u.url}`);
    }
  };
  const copyNames = (u: UrlRecord) => doCopy(u.paramNames.join('\n'), `n-${u.url}`);

  return (
    <div className="flex h-full flex-col">
      <Toast error={error ?? copyError} message={null} />
      <div className="flex items-center gap-1.5 border-b border-slate-700 px-3 py-1.5">
        {(['all', 'GET', 'POST', 'OTHER'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMethodF(m)}
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
              methodF === m ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {m}
          </button>
        ))}
        {(['all', 'page', 'network'] as const).map((src) => (
          <button
            key={src}
            onClick={() => setSourceF(src)}
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
              sourceF === src ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {src}
          </button>
        ))}
        <CopyButton
          onCopy={() =>
            void doCopy(
              rows.filter((u) => selected.has(u.url)).map((u) => maskUrl(u.url)).join('\n'),
              '__selurls__',
            )
          }
          flashKey="__selurls__"
          flash={flash}
          label={`Copy Selected URLs (${selected.size})`}
          disabled={selected.size === 0}
        />
        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          <input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} className="accent-sky-500" />
          include values
        </label>
        <span className="ml-auto text-xs text-slate-400">{urls ? `${rows.length} URLs` : '…'}</span>
      </div>
      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search URLs or parameter names…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-sky-600"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {urls === null ? (
          <Empty label="Loading…" />
        ) : rows.length === 0 ? (
          <Empty label={'No URLs observed for this site yet.\nBrowse the site — links, form actions and network requests\nare cataloged automatically.'} />
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
                    <SourceBadge source={((u.sources ?? [])[0] ?? 'other') as 'page' | 'network'} />
                    <span className="truncate font-mono text-slate-300" title={u.url}>
                      <span className="text-slate-500">{u.origin}</span>
                      {display.slice(u.origin.length)}
                    </span>
                    <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <span className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">{u.method}</span>
                      <span className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">×{u.occurrences}</span>
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

function SourceBadge({ source }: { source: 'page' | 'network' }) {
  return (
    <span className={`rounded px-1 text-[10px] ${source === 'network' ? 'bg-violet-500/15 text-violet-300' : 'bg-slate-700 text-slate-300'}`}>
      {source}
    </span>
  );
}
