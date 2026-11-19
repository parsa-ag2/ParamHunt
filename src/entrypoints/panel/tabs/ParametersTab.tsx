import React, { useMemo, useState } from 'react';
import type { Finding, FindingPage } from '@shared/types/finding';
import { sendRequest } from '@core/messaging/bridge';
import { paramName, namesToClipboardText, uniqueParamNames } from '@modules/param-discovery/lib/format';
import { groupParams, type GroupMode } from './grouping';
import { Badge, Chip, CopyButton, Empty, Toast, useCopyFlash } from '../ui';

const SOURCE_FILTERS = ['all', 'url', 'dom', 'form', 'js', 'network', 'cookie', 'storage'] as const;
const METHOD_FILTERS = ['all', 'GET', 'POST', 'none'] as const;
const CONF_FILTERS = ['all', 'high', 'medium', 'low'] as const;
const MAX_RENDER_ROWS = 300;

/** Parameter Explorer — search/filter/sort/select/copy/inspect/note. */
export default function ParametersTab({
  page,
  error,
  onRefresh,
  onBuildQuery,
}: {
  page: FindingPage | null;
  error: string | null;
  onRefresh: () => void;
  onBuildQuery: (names: string[], path: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [source, setSource] = useState<(typeof SOURCE_FILTERS)[number]>('all');
  const [methodF, setMethodF] = useState<(typeof METHOD_FILTERS)[number]>('all');
  const [confF, setConfF] = useState<(typeof CONF_FILTERS)[number]>('all');
  const [sort, setSort] = useState<'recent' | 'occurrences' | 'name'>('recent');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'flat' | 'grouped'>('flat');
  const [groupMode, setGroupMode] = useState<GroupMode>('path');
  const [collapsePatterns, setCollapsePatterns] = useState(false);
  const [flash, copyError, doCopy] = useCopyFlash();

  const items = page?.items ?? [];
  const rows = useMemo(() => {
    let out = page?.items ?? [];
    if (source !== 'all') {
      out = out.filter((f) => {
        const sources = (f.detail as Record<string, unknown>)?.sources as Record<string, number> | undefined;
        return sources ? Object.keys(sources).includes(source) : false;
      });
    }
    if (methodF !== 'all') {
      out = out.filter((f) => {
        const methods = (f.detail as Record<string, unknown>)?.methods as string[] | undefined;
        return methodF === 'none' ? !methods || methods.length === 0 : (methods ?? []).includes(methodF);
      });
    }
    if (confF !== 'all') {
      out = out.filter((f) => ((f.detail as Record<string, unknown>)?.confidence ?? 'low') === confF);
    }
    const needle = filter.trim().toLowerCase();
    if (needle) out = out.filter((f) => paramName(f).toLowerCase().includes(needle));
    const sorted = [...out];
    if (sort === 'name') sorted.sort((a, b) => paramName(a).localeCompare(paramName(b)));
    else if (sort === 'occurrences') sorted.sort((a, b) => b.occurrences - a.occurrences);
    return sorted;
  }, [page, filter, source, sort]);

  const allNames = useMemo(() => uniqueParamNames(rows), [rows]);
  /** Group-by-URL runs on ALREADY-COLLECTED data only — memoized, no scans. */
  const groups = useMemo(
    () => (view === 'grouped' ? groupParams(rows, { mode: groupMode, collapsePatterns }) : []),
    [view, rows, groupMode, collapsePatterns],
  );

  const copyRow = (f: Finding) => doCopy(paramName(f), f.id);
  const copyAll = () => doCopy(namesToClipboardText(allNames), '__all__');
  const copySelected = () =>
    doCopy(namesToClipboardText(uniqueParamNames(rows.filter((f) => selected.has(f.id)))), '__sel__');
  const copyFiltered = () => doCopy(namesToClipboardText(uniqueParamNames(rows)), '__filtered__');
  const selectAll = () => setSelected(new Set(items.map((f) => f.id)));
  const selectFiltered = () => setSelected((prev) => new Set([...prev, ...rows.map((f) => f.id)]));
  const deselectAll = () => setSelected(new Set());
  const invertSelection = () =>
    setSelected((prev) => new Set((items ?? []).filter((f) => !prev.has(f.id)).map((f) => f.id)));
  const copyBySource = (src: string) =>
    doCopy(
      namesToClipboardText(
        uniqueParamNames(
          rows.filter((f) => Object.keys(((f.detail as Record<string, unknown>)?.sources ?? {}) as object).includes(src)),
        ),
      ),
      `src-${src}`,
    );
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
            {s === 'all' ? 'all src' : s}
          </Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-700" />
        {METHOD_FILTERS.map((m) => (
          <Chip key={m} active={methodF === m} onClick={() => setMethodF(m)}>
            {m}
          </Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-700" />
        {CONF_FILTERS.map((c) => (
          <Chip key={c} active={confF === c} onClick={() => setConfF(c)}>
            {c}
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
        <CopyButton onCopy={copyFiltered} flashKey="__filtered__" flash={flash} label="Copy Filtered" disabled={rows.length === 0} />
        {source !== 'all' && (
          <CopyButton onCopy={() => void copyBySource(source)} flashKey={`src-${source}`} flash={flash} label={`Copy ${source}`} />
        )}
        <span className="mx-1 h-4 w-px bg-slate-700" />
        <Chip onClick={selectAll}>Select All</Chip>
        <Chip onClick={selectFiltered}>Select Filtered</Chip>
        <Chip onClick={invertSelection}>Invert</Chip>
        <Chip onClick={deselectAll}>Deselect All</Chip>
        {selected.size > 0 && <span className="text-[10px] text-slate-400">{selected.size} selected</span>}
      </div>

      <div className="flex items-center gap-1.5 border-b border-slate-700 px-3 py-1.5">
        <Chip active={view === 'flat'} onClick={() => setView('flat')}>All Parameters</Chip>
        <Chip active={view === 'grouped'} onClick={() => setView('grouped')}>Group by URL</Chip>
        {view === 'grouped' && (
          <>
            <span className="mx-1 h-4 w-px bg-slate-700" />
            <Chip active={groupMode === 'path'} onClick={() => setGroupMode('path')}>by path</Chip>
            <Chip active={groupMode === 'origin'} onClick={() => setGroupMode('origin')}>by origin</Chip>
            <Chip active={groupMode === 'method'} onClick={() => setGroupMode('method')}>by method</Chip>
            <label className="ml-2 flex items-center gap-1 text-[10px] text-slate-400">
              <input
                type="checkbox"
                checked={collapsePatterns}
                onChange={(e) => setCollapsePatterns(e.target.checked)}
                className="accent-sky-500"
              />
              collapse /users/123 → /users/&#123;id&#125;
            </label>
          </>
        )}
      </div>
      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search parameters…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-sky-600"
        />
      </div>

      {/* table (flat) + grouped-by-URL view */}
      <div className="flex-1 overflow-y-auto">
        {view === 'grouped' ? (
          page === null ? (
            <Empty label="Loading…" />
          ) : groups.length === 0 ? (
            <Empty label="Nothing to group yet — collect parameters first." />
          ) : (
            <ul className="text-xs">
              {groups.slice(0, 100).map((g) => (
                <GroupRow
                  key={g.key}
                  group={g}
                  mode={groupMode}
                  flash={flash}
                  onCopyNames={() => void doCopy(namesToClipboardText(uniqueParamNames(g.items)), `g-${g.key}`)}
                  onCopyPairs={() =>
                    void doCopy(
                      g.items.map((f) => `${paramName(f)}=${String((f.detail as Record<string, unknown>)?.firstSample ?? '')}`).join('\n'),
                      `gp-${g.key}`,
                    )
                  }
                  onBuild={() => onBuildQuery(uniqueParamNames(g.items), groupMode === 'path' ? g.label : '/')}
                />
              ))}
            </ul>
          )
        ) : page === null ? (
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


/** Grouped-by-URL row: header with real counts + actions, expandable param list. */
function GroupRow({
  group,
  mode,
  flash,
  onCopyNames,
  onCopyPairs,
  onBuild,
}: {
  group: ReturnType<typeof groupParams>[number];
  mode: GroupMode;
  flash: string | null;
  onCopyNames: () => void;
  onCopyPairs: () => void;
  onBuild: () => void;
}) {
  const [open, setOpen] = useState(false);
  const preview = group.items.slice(0, 5).map((f) => paramName(f));
  return (
    <li className="border-t border-slate-800">
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-slate-800/60"
        onClick={() => setOpen(!open)}
      >
        <span className="text-slate-500">{open ? '▾' : '▸'}</span>
        <span className="font-mono text-slate-200">{group.label}</span>
        <Badge tone="info">{group.items.length} params</Badge>
        <span className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <CopyButton onCopy={onCopyNames} flashKey={`g-${group.key}`} flash={flash} label="Copy Parameters" />
          <CopyButton onCopy={onCopyPairs} flashKey={`gp-${group.key}`} flash={flash} label="Copy name=value" />
          <button
            onClick={onBuild}
            className="rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-sky-500"
          >
            Build Query
          </button>
        </span>
      </div>
      {!open && preview.length > 0 && (
        <div className="px-9 pb-1.5 font-mono text-[11px] text-slate-500">
          {preview.join(' · ')}
          {group.items.length > preview.length ? ` · … +${group.items.length - preview.length}` : ''}
        </div>
      )}
      {open && (
        <table className="w-full text-left text-[11px]">
          <thead className="bg-slate-800/70 text-slate-400">
            <tr>
              <th className="px-9 py-1 font-medium">Parameter</th>
              <th className="px-2 py-1 font-medium">Source</th>
              <th className="px-2 py-1 font-medium">Method</th>
              <th className="px-2 py-1 font-medium">×Seen</th>
            </tr>
          </thead>
          <tbody>
            {group.items.slice(0, 200).map((f) => {
              const d = f.detail as Record<string, unknown>;
              const sources = (d.sources ?? {}) as Record<string, number>;
              return (
                <tr key={f.id} className="border-t border-slate-800/70">
                  <td className="px-9 py-1 font-mono text-sky-300">{paramName(f)}</td>
                  <td className="px-2 py-1">
                    <span className="flex gap-1">
                      {Object.keys(sources).map((s) => (
                        <Badge key={s} tone="info">{s}</Badge>
                      ))}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-slate-400">
                    {((d.methods ?? []) as string[]).join(', ') || '—'}
                  </td>
                  <td className="px-2 py-1 text-slate-300">{`×${f.occurrences}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </li>
  );
}
