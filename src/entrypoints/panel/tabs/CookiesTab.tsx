import React, { useEffect, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { CookieMeta } from '@shared/types/http';
import { CopyButton, Empty, Toast, useCopyFlash } from '../ui';

/** Cookies — metadata only (name/domain/path/flags). Values are NEVER shown. */
export default function CookiesTab({ origin, tabId }: { origin: string; tabId: number | null }) {
  const [cookies, setCookies] = useState<CookieMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [flash, copyError, doCopy] = useCopyFlash();

  const load = (o: string) => {
    if (tabId == null) return;
    void sendRequest<{ cookies: CookieMeta[] }>({ type: 'cookies/query', tabId })
      .then((r) => {
        // keep only this site's cookies
        const host = origin.replace(/^https?:\/\//, '');
        setCookies(origin ? r.cookies.filter((c) => c.domain === host || c.domain.endsWith(`.${host}`)) : r.cookies);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    if (origin) load(origin);
  }, [origin, tabId]);

  const rows = (cookies ?? []).filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="flex h-full flex-col">
      <Toast error={error ?? copyError} message={null} />
      <div className="flex items-center gap-2 border-b border-slate-700 px-3 py-1.5">
        <button
          onClick={() => load(origin)}
          className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-500"
        >
          Load cookie metadata
        </button>
        <span className="text-[10px] text-slate-500">values are never displayed or copied</span>
        <span className="ml-auto text-xs text-slate-400">{cookies ? `${rows.length} cookies` : '…'}</span>
      </div>
      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search cookie names…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs outline-none placeholder:text-slate-500"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {cookies === null ? (
          <Empty label="Press “Load cookie metadata” — this is a user-controlled action." />
        ) : rows.length === 0 ? (
          <Empty label="No cookies for this site's cookies-context (or none match the filter)." />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-800 text-slate-400">
              <tr>
                <th className="px-3 py-1.5 font-medium">Name</th>
                <th className="px-2 py-1.5 font-medium">Domain</th>
                <th className="px-2 py-1.5 font-medium">Path</th>
                <th className="px-2 py-1.5 font-medium">Expires</th>
                <th className="px-2 py-1.5 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={`${c.domain}${c.path}${c.name}`} className="border-t border-slate-800">
                  <td className="px-3 py-1.5 font-mono text-sky-300">
                    <span className="flex items-center gap-1.5">
                      {c.name}
                      <CopyButton onCopy={() => doCopy(c.name, c.name)} flashKey={c.name} flash={flash} label="Copy" />
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">{c.domain}</td>
                  <td className="px-2 py-1.5 text-slate-400">{c.path}</td>
                  <td className="px-2 py-1.5 text-slate-400">
                    {c.expirationDate ? new Date(c.expirationDate * 1000).toLocaleDateString() : 'session'}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="flex gap-1">
                      {c.secure && <span className="rounded bg-slate-700 px-1 text-[10px]">Secure</span>}
                      {c.httpOnly && <span className="rounded bg-slate-700 px-1 text-[10px]">HttpOnly</span>}
                      <span className="rounded bg-slate-700 px-1 text-[10px]">SameSite={c.sameSite}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

