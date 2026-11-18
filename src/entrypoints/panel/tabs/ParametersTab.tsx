import React, { useMemo, useState } from 'react';
import type { Finding, FindingPage } from '@shared/types/finding';
import { sendRequest } from '@core/messaging/bridge';
import { paramName, namesToClipboardText, uniqueParamNames } from '@modules/param-discovery/lib/format';
import { Badge, Chip, CopyButton, Empty, Toast, useCopyFlash } from '../ui';

const SOURCE_FILTERS = ['all', 'url', 'dom', 'form', 'js', 'network'] as const;
const MAX_RENDER_ROWS = 300;

/** Parameter Explorer — search/filter/sort/select/copy/inspect/note. */
export default function ParametersTab({
  page,
  error,
  onRefresh,
}: {
  page: FindingPage | null;
  error: string | null;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [source, setSource] = useState<(typeof SOURCE_FILTERS)[number]>('all');
  const [sort, setSort] = useState<'recent' | 'occurrences' | 'name'>('recent');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [flash, copyError, doCopy] = useCopyFlash();

  const rows = useMemo(() => {
    let out = page?.items ?? [];
    if (source !== 'all') {
      out = out.filter((f) => {
        const sources = (f.detail as Record<string, unknown>)?.sources as Record<string, number> | undefined;
        return sources ? Object.keys(sources).includes(source) : false;
      });
    }
    const needle = filter.trim().toLowerCase();
    if (needle) out = out.filter((f) => paramName(f).toLowerCase().includes(needle));
    const sorted = [...out];
    if (sort === 'name') sorted.sort((a, b) => paramName(a).localeCompare(paramName(b)));
    else if (sort === 'occurrences') sorted.sort((a, b) => b.occurrences - a.occurrences);
    return sorted;
  }, [page, filter, source, sort]);

  const allNames = useMemo(() => uniqueParamNames(rows), [rows]);

  const copyRow = (f: Finding) => doCopy(paramName(f), f.id);
  const copyAll = () => doCopy(namesToClipboardText(allNames), '__all__');
  const copySelected = () =>
    doCopy(namesToClipboardText(uniqueParamNames(rows.filter((f) => selected.has(f.id)))), '__sel__');
  const copyPair = (f: Finding, value: string) => doCopy(`${paramName(f)}=${value}`, `pair-${f.id}`);

  const setStatus = async (f: Finding, status: Finding['status']) => {
    await sendRequest({ type: 'findings/status', ids: [f.id], status });
    onRefresh();
  };

  return (
    <div className="flex h-full flex-col">
      <Toast error={error ?? copyError} message={null} />

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-700 px-3 py-1.5">
        {SOURCE_FILTERS.map((s) => (
          <Chip key={s} active={source === s} onClick={() => setSource(s)}>
            {s === 'all' ? 'all sources' : s}
          </Chip>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 outline-none"
        >
          <option value="recent">sort: recent</option>
          <option value="occurrences">sort: occurrences</option>
          <option value="name">sort: name</option>
        </select>
        <CopyButton onCopy={copyAll} flashKey="__all__" flash={flash} label={`Copy All (${allNames.length})`} disabled={allNames.length === 0} />
        <CopyButton
          onCopy={copySelected}
          flashKey="__sel__"
          flash={flash}
          label={`Copy Selected (${selected.size})`}
          disabled={selected.size === 0}
        />
      </div>

      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search parameters…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-sky-600"
        />
      </div>

      {/* table */}
      <div className="flex-1 overflow-y-auto">
        {page === null ? (
          <Empty label="Loading…" />
        ) : rows.length === 0 ? (
          <Empty
            label={
              (page?.total ?? 0) === 0
                ? 'No parameters discovered for this site yet.\nBrowse the site — collection runs automatically.\nRescan injects the collector into tabs opened before install.'
                : 'No parameters match the current filter.'
            }
          />
        ) : (
          <>
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-800 text-slate-400">
                <tr>
                  <th className="w-6 px-2 py-1.5" />
                  <th className="px-2 py-1.5 font-medium">Parameter</th>
                  <th className="px-2 py-1.5 font-medium">Source</th>
                  <th className="px-2 py-1.5 font-medium">Method</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">×Seen</th>
                  <th className="px-2 py-1.5 font-medium">Conf.</th>
                  <th className="w-16 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, MAX_RENDER_ROWS).map((f) => {
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
                            onChange={() =>
                              setSelected((prev) => {
                                const n = new Set(prev);
                                n.has(f.id) ? n.delete(f.id) : n.add(f.id);
                                return n;
                              })
                            }
                            className="accent-sky-500"
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono text-sky-300">{name}</td>
                        <td className="px-2 py-1.5">
                          <span className="flex gap-1">
                            {Object.keys(sources).map((s) => (
                              <Badge key={s} tone="info">{s}</Badge>
                            ))}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-slate-400">{methods || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-400">{inputTypes || kinds[0] || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-300">{`×${f.occurrences}`}</td>
                        <td className="px-2 py-1.5">
                          <Badge tone={(d.confidence as string) === 'high' ? 'ok' : (d.confidence as string) === 'medium' ? 'warn' : 'info'}>
                            {(d.confidence as string) ?? 'low'}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <CopyButton onCopy={() => void copyRow(f)} flashKey={f.id} flash={flash} label="Copy" />
                        </td>
                      </tr>
                      {open && <DetailRow finding={f} onCopyPair={copyPair} onRefresh={onRefresh} />}
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

/** Expandable detail + interactive local value inspector + note. */
function DetailRow({
  finding,
  onCopyPair,
  onRefresh,
}: {
  finding: Finding;
  onCopyPair: (f: Finding, value: string) => void;
  onRefresh: () => void;
}) {
  const d = finding.detail as Record<string, unknown>;
  const name = paramName(finding);
  const [value, setValue] = useState<string>(String(d.firstSample ?? ''));
  const [note, setNote] = useState<string>(finding.note ?? '');
  const [savedNote, setSavedNote] = useState(false);
  const setStatus = async (status: Finding['status']) => {
    await sendRequest({ type: 'findings/status', ids: [finding.id], status });
    onRefresh();
  };

  return (
    <tr className="border-t border-slate-800 bg-slate-800/40">
      <td colSpan={8} className="px-3 py-2">
        <div className="space-y-2 text-[11px] text-slate-300">
          {/* interactive local inspector — edits stay local until copied */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-sky-300">{name}</span>
            <span className="text-slate-500">=</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="observed value (editable, local only)"
              className="flex-1 rounded bg-slate-900 px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-sky-600"
            />
            <button
              onClick={() => onCopyPair(finding, value)}
              className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] hover:bg-slate-600"
            >
              Copy name=value
            </button>
          </div>
          <p className="text-[10px] text-slate-500">
            The editor is local to this panel — it never touches the page or sends requests.
          </p>

          <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1">
            <dt className="text-slate-500">kinds</dt>
            <dd>{((d.kinds ?? []) as string[]).join(', ') || '—'}</dd>
            <dt className="text-slate-500">first page</dt>
            <dd className="break-all font-mono">{String(d.firstPageUrl ?? '—')}</dd>
            <dt className="text-slate-500">last page</dt>
            <dd className="break-all font-mono">{String(d.lastPageUrl ?? '—')}</dd>
            <dt className="text-slate-500">first seen</dt>
            <dd>{new Date(finding.firstSeenAt).toLocaleString()}</dd>
          </dl>

          {/* note + triage */}
          <div className="flex items-start gap-2">
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="researcher note…"
              className="flex-1 rounded bg-slate-900 p-1.5 text-[11px] outline-none focus:ring-1 focus:ring-sky-600"
            />
            <div className="space-y-1">
              <button
                onClick={() =>
                  void sendRequest({ type: 'findings/note', id: finding.id, note }).then(() => {
                    setSavedNote(true);
                    setTimeout(() => setSavedNote(false), 1500);
                  })
                }
                className="block rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-sky-500"
              >
                {savedNote ? '✓ Saved' : 'Save note'}
              </button>
              <button
                onClick={() => void setStatus('confirmed')}
                className="block rounded bg-slate-700 px-1.5 py-0.5 text-[10px] hover:bg-slate-600"
              >
                ★ Confirm
              </button>
              <button
                onClick={() => void setStatus('ignored')}
                className="block rounded bg-slate-700 px-1.5 py-0.5 text-[10px] hover:bg-slate-600"
              >
                Ignore
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
