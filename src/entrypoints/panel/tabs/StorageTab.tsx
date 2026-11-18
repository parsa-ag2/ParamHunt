import React, { useEffect, useMemo, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { StorageKeyMeta } from '@shared/types/http';
import { CopyButton, Empty, Toast, useCopyFlash } from '../ui';

/** Storage — key metadata (key/type/origin/size) from the inspected tab. */
export default function StorageTab({ tabId }: { tabId: number | null }) {
  const [entries, setEntries] = useState<StorageKeyMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [flash, copyError, doCopy] = useCopyFlash();

  const load = () => {
    if (tabId == null) return;
    setLoading(true);
    void sendRequest<{ entries: StorageKeyMeta[] }>({ type: 'storage/inspect', tabId })
      .then((r) => {
        setEntries(r.entries);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setEntries(null); // per-tab data — never show stale entries from another site
  }, [tabId]);

  const rows = useMemo(() => {
    const list = entries ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((e) => e.key.toLowerCase().includes(needle));
  }, [entries, filter]);

  return (
    <div className="flex h-full flex-col">
      <Toast error={error ?? copyError} message={null} />
      <div className="flex items-center gap-2 border-b border-slate-700 px-3 py-1.5">
        <button
          onClick={load}
          disabled={tabId == null || loading}
          className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? 'Reading…' : 'Load storage keys'}
        </button>
        <span className="text-[10px] text-slate-500">
          key names + sizes only — values are never collected or displayed
        </span>
        <span className="ml-auto text-xs text-slate-400">{entries ? `${rows.length} keys` : '…'}</span>
      </div>
      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search storage keys…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs outline-none placeholder:text-slate-500"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {entries === null ? (
          <Empty label="Press “Load storage keys” — inspection is user-controlled." />
        ) : rows.length === 0 ? (
          <Empty label="No storage keys for this origin (or none match the filter)." />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-800 text-slate-400">
              <tr>
                <th className="px-3 py-1.5 font-medium">Key</th>
                <th className="px-2 py-1.5 font-medium">Type</th>
                <th className="px-2 py-1.5 font-medium">Size (chars)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.type}:${e.key}`} className="border-t border-slate-800">
                  <td className="px-3 py-1.5 font-mono text-sky-300">
                    <span className="flex items-center gap-1.5">
                      {e.key}
                      <CopyButton onCopy={() => doCopy(e.key, `${e.type}-${e.key}`)} flashKey={`${e.type}-${e.key}`} flash={flash} label="Copy" />
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">{e.type === 'local' ? 'localStorage' : 'sessionStorage'}</td>
                  <td className="px-2 py-1.5 text-slate-400">{e.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
