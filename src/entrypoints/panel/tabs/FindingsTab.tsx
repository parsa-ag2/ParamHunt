import React, { useMemo, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { Finding, FindingPage } from '@shared/types/finding';
import { Badge, Empty, Toast } from '../ui';

/** Findings — the triage desk: status filters, notes, search, removal. */
export default function FindingsTab({
  page,
  error,
  onRefresh,
}: {
  page: FindingPage | null;
  error: string | null;
  onRefresh: () => void;
}) {
  const [status, setStatus] = useState<'all' | Finding['status']>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    let out = page?.items ?? [];
    if (status !== 'all') out = out.filter((f) => f.status === status);
    const needle = search.trim().toLowerCase();
    if (needle) {
      out = out.filter(
        (f) => f.title.toLowerCase().includes(needle) || (f.note ?? '').toLowerCase().includes(needle),
      );
    }
    return out;
  }, [page, status, search]);

  const setFindingStatus = async (f: Finding, s: Finding['status']) => {
    await sendRequest({ type: 'findings/status', ids: [f.id], status: s });
    onRefresh();
  };

  const remove = async (f: Finding) => {
    if (!confirm(`Remove finding "${f.title}"?`)) return;
    await sendRequest({ type: 'findings/remove', ids: [f.id] });
    onRefresh();
  };

  return (
    <div className="flex h-full flex-col">
      <Toast error={error} message={null} />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-700 px-3 py-1.5">
        {(['all', 'new', 'confirmed', 'reviewed', 'ignored'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
              status === s ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400">{page ? `${rows.length} findings` : '…'}</span>
      </div>
      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search findings and notes…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs outline-none placeholder:text-slate-500"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {page === null ? (
          <Empty label="Loading…" />
        ) : rows.length === 0 ? (
          <Empty label={'No findings here yet.\nEverything ParamHunt discovers lands in this triage desk —\nconfirm ★ the ones worth reporting.'} />
        ) : (
          <ul className="text-xs">
            {rows.map((f) => (
              <li key={f.id} className="border-t border-slate-800">
                <div
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-800/60"
                  onClick={() => setExpanded(expanded === f.id ? null : f.id)}
                >
                  <StatusChip status={f.status} />
                  <span className="truncate text-slate-200">{f.title}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <Badge tone="info">{f.source}</Badge>
                    {f.note && <span title={f.note}>📝</span>}
                    <span className="text-[10px] text-slate-500">{new Date(f.lastSeenAt).toLocaleTimeString()}</span>
                  </span>
                </div>
                {expanded === f.id && (
                  <div className="space-y-1.5 bg-slate-800/40 px-3 py-2 text-[11px]">
                    <dl className="grid grid-cols-[90px_1fr] gap-x-2">
                      <dt className="text-slate-500">location</dt>
                      <dd className="break-all font-mono">{f.location}</dd>
                      <dt className="text-slate-500">occurrences</dt>
                      <dd>×{f.occurrences}</dd>
                      <dt className="text-slate-500">first seen</dt>
                      <dd>{new Date(f.firstSeenAt).toLocaleString()}</dd>
                    </dl>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => void setFindingStatus(f, 'confirmed')}
                        className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] text-white hover:bg-emerald-500"
                      >
                        ★ Confirm
                      </button>
                      <button
                        onClick={() => void setFindingStatus(f, 'reviewed')}
                        className="rounded bg-slate-700 px-2 py-0.5 text-[10px] hover:bg-slate-600"
                      >
                        Mark reviewed
                      </button>
                      <button
                        onClick={() => void setFindingStatus(f, 'ignored')}
                        className="rounded bg-slate-700 px-2 py-0.5 text-[10px] hover:bg-slate-600"
                      >
                        Ignore
                      </button>
                      <button
                        onClick={() => void remove(f)}
                        className="rounded bg-red-600/80 px-2 py-0.5 text-[10px] text-white hover:bg-red-500"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: Finding['status'] }) {
  const cls: Record<Finding['status'], string> = {
    new: 'bg-sky-500/15 text-sky-300',
    reviewed: 'bg-slate-500/15 text-slate-300',
    confirmed: 'bg-emerald-500/15 text-emerald-300',
    ignored: 'bg-slate-700 text-slate-500',
  };
  return <span className={`rounded px-1 text-[10px] uppercase ${cls[status]}`}>{status}</span>;
}
