import React, { useMemo, useState } from 'react';
import type { Finding, FindingPage } from '@shared/types/finding';
import { paramName, namesToClipboardText, uniqueParamNames } from '@modules/param-discovery/lib/format';
import { groupParams, type GroupMode } from './grouping';
import { isConfirmedParam } from '@shared/paramQuality';
import { Badge, Chip, CopyButton, Empty, Toast, useCopyFlash } from '../ui';
import { sendRequest } from '@core/messaging/bridge';

/**
 * Parameter Explorer — v0.5 simplified toolbar:
 *   [search] [All | Group by URL] [Source ▼] [More ▼] [Copy ▼]
 * Method/sort/selection controls live inside "More"; copy variants inside
 * "Copy". Weak JS-object candidates are hidden by default (the "possible"
 * filter in More reveals them). Grouping is a memoized client-side
 * transform of already-collected findings — switching modes never scans.
 */

const SOURCE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'url', label: 'URL' },
  { id: 'dom', label: 'DOM' },
  { id: 'form', label: 'Form' },
  { id: 'js', label: 'JavaScript' },
  { id: 'network', label: 'Network' },
  { id: 'cookie', label: 'Cookies' },
  { id: 'storage', label: 'Storage' },
] as const;

const METHOD_FILTERS = ['all', 'GET', 'POST', 'none'] as const;
const MAX_RENDER_ROWS = 300;

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
  const items = page?.items ?? [];
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'flat' | 'grouped'>('flat');
  const [groupMode, setGroupMode] = useState<GroupMode>('path');
  const [collapsePatterns, setCollapsePatterns] = useState(false);
  const [source, setSource] = useState<string>('all');
  const [methodF, setMethodF] = useState<'all' | 'GET' | 'POST' | 'none'>('all');
  const [sort, setSort] = useState<'recent' | 'occurrences' | 'name'>('recent');
  const [showPossible, setShowPossible] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [flash, copyError, doCopy] = useCopyFlash();

  const rows = useMemo(() => {
    let out = items.filter(isConfirmedParam); // weak JS-object noise hidden by default
    if (showPossible) out = items.filter((f) => !isConfirmedParam(f));
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
    const needle = filter.trim().toLowerCase();
    if (needle) out = out.filter((f) => paramName(f).toLowerCase().includes(needle));
    const sorted = [...out];
    if (sort === 'name') sorted.sort((a, b) => paramName(a).localeCompare(paramName(b)));
    else if (sort === 'occurrences') sorted.sort((a, b) => b.occurrences - a.occurrences);
    return sorted;
  }, [items, filter, source, methodF, sort, showPossible]);

  const allNames = useMemo(() => uniqueParamNames(rows), [rows]);
  const groups = useMemo(
    () => (view === 'grouped' ? groupParams(rows, { mode: groupMode, collapsePatterns }) : []),
    [view, rows, groupMode, collapsePatterns],
  );
  const possibleCount = useMemo(() => items.filter((f) => !isConfirmedParam(f)).length, [items]);

  const copyRow = (f: Finding) => doCopy(paramName(f), f.id);
  const copyPair = (f: Finding, value: string) => doCopy(`${paramName(f)}=${value}`, `pair-${f.id}`);
  const copyAll = () => doCopy(namesToClipboardText(allNames), '__all__');
  const copyFiltered = () => doCopy(namesToClipboardText(uniqueParamNames(rows)), '__filtered__');
  const copySelected = () =>
    doCopy(namesToClipboardText(uniqueParamNames(rows.filter((f) => selected.has(f.id)))), '__sel__');
  const copyBySource = (src: string) =>
    doCopy(
      namesToClipboardText(
        uniqueParamNames(
          rows.filter((f) => Object.keys(((f.detail as Record<string, unknown>)?.sources ?? {}) as object).includes(src)),
        ),
      ),
      `src-${src}`,
    );

  const selectAll = () => setSelected(new Set(items.map((f) => f.id)));
  const selectFiltered = () => setSelected((prev) => new Set([...prev, ...rows.map((f) => f.id)]));
  const deselectAll = () => setSelected(new Set());
  const invertSelection = () =>
    setSelected((prev) => new Set((items ?? []).filter((f) => !prev.has(f.id)).map((f) => f.id)));

  const setStatus = async (f: Finding, status: Finding['status']) => {
    await sendRequest({ type: 'findings/status', ids: [f.id], status });
    onRefresh();
  };

  return (
    <div className="flex h-full flex-col">
      <Toast error={error ?? copyError} message={null} />

      {/* row 1: search */}
      <div className="border-b border-slate-700 px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search parameters…"
          className="w-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:ring-1 focus:ring-sky-600"
        />
      </div>

      {/* row 2: mode + compact dropdowns */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-700 px-3 py-1.5">
        <Chip active={view === 'flat'} onClick={() => setView('flat')}>All Parameters</Chip>
        <Chip active={view === 'grouped'} onClick={() => setView('grouped')}>Group by URL</Chip>

        <Dropdown label={`Source: ${source === 'all' ? 'All' : source}`} width="w-44">
          {SOURCE_FILTERS.map((s) => (
            <MenuItem
              key={s.id}
              active={source === s.id}
              onClick={() => {
                setSource(s.id);
                setMoreOpen(false);
              }}
            >
              {s.label}
            </MenuItem>
          ))}
        </Dropdown>

        <Dropdown label="More Filters" width="w-60" open={moreOpen} setOpen={setMoreOpen}>
          <div className="space-y-1.5 p-2 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="w-12 text-slate-500">method</span>
              <select
                value={methodF}
                onChange={(e) => setMethodF(e.target.value as typeof methodF)}
                className="flex-1 rounded bg-slate-800 px-1 py-0.5 text-[10px] outline-none"
              >
                {METHOD_FILTERS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-12 text-slate-500">sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="flex-1 rounded bg-slate-800 px-1 py-0.5 text-[10px] outline-none"
              >
                <option value="recent">recent</option>
                <option value="occurrences">occurrences</option>
                <option value="name">name</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showPossible}
                onChange={(e) => setShowPossible(e.target.checked)}
                className="accent-sky-500"
              />
              Show possible ({possibleCount})
            </label>
            <div className="flex flex-wrap gap-1 border-t border-slate-700 pt-1.5">
              <Chip onClick={selectAll}>Select All</Chip>
              <Chip onClick={selectFiltered}>Select Filtered</Chip>
              <Chip onClick={invertSelection}>Invert</Chip>
              <Chip onClick={deselectAll}>Deselect All</Chip>
            </div>
          </div>
        </Dropdown>

        <Dropdown label="Copy ▾" width="w-52" open={copyOpen} setOpen={setCopyOpen}>
          <MenuItem
            onClick={() => {
              void doCopy(namesToClipboardText(allNames), '__all__');
              setCopyOpen(false);
            }}
          >
            Copy All ({allNames.length})
          </MenuItem>
          <MenuItem
            onClick={() => {
              void doCopy(namesToClipboardText(uniqueParamNames(rows)), '__filtered__');
              setCopyOpen(false);
            }}
          >
            Copy Filtered ({rows.length})
          </MenuItem>
          <MenuItem
            onClick={() => {
              void doCopy(namesToClipboardText(uniqueParamNames(rows.filter((f) => selected.has(f.id)))), '__sel__');
              setCopyOpen(false);
            }}
          >
            Copy Selected ({selected.size})
          </MenuItem>
          {source !== 'all' && (
            <MenuItem
              onClick={() => {
                copyBySource(source);
                setCopyOpen(false);
              }}
            >
              Copy by source: {source}
            </MenuItem>
          )}
        </Dropdown>

        {view === 'grouped' && (
          <>
            <Chip active={groupMode === 'path'} onClick={() => setGroupMode('path')}>path</Chip>
            <Chip active={groupMode === 'origin'} onClick={() => setGroupMode('origin')}>origin</Chip>
            <Chip active={groupMode === 'method'} onClick={() => setGroupMode('method')}>method</Chip>
          </>
        )}

        <span className="ml-auto text-xs text-slate-400">
          {page ? `${rows.length} of ${page.total} params` : '…'}
        </span>
      </div>

      {view === 'grouped' && (
        <div className="flex items-center gap-1.5 border-b border-slate-700 px-3 py-1">
          <label className="flex items-center gap-1 text-[10px] text-slate-400">
            <input
              type="checkbox"
              checked={collapsePatterns}
              onChange={(e) => setCollapsePatterns(e.target.checked)}
              className="accent-sky-500"
            />
            collapse /users/123 → /users/&#123;id&#125;
          </label>
        </div>
      )}

      {/* body */}
      <div className="flex-1 overflow-y-auto">
        {page === null ? (
          <Empty label="Loading…" />
        ) : view === 'grouped' ? (
          groups.length === 0 ? (
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
                      g.items
                        .map((f) => `${paramName(f)}=${String((f.detail as Record<string, unknown>)?.firstSample ?? '')}`)
                        .join('\n'),
                      `gp-${g.key}`,
                    )
                  }
                  onBuild={() => onBuildQuery(uniqueParamNames(g.items), groupMode === 'path' ? g.label : '/')}
                />
              ))}
            </ul>
          )
        ) : rows.length === 0 ? (
          <Empty
            label={
              (page?.total ?? 0) === 0
                ? 'No parameters discovered for this site yet.\nBrowse the target site — collection runs automatically.'
                : possibleCount > 0 && !showPossible
                  ? `No confirmed parameters match.\n${possibleCount} possible (low-confidence) candidates exist —\nenable "Show possible" in More Filters.`
                  : 'No parameters match the current filter.'
            }
          />
        ) : (
          <>
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-800 text-slate-400">
                <tr>
                  <th className="w-6 px-2 py-1.5" />
                  <th className="px-2 py-1.5 font-medium">Parameter</th>
                  <th className="px-2 py-1.5 font-medium">Source</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">Found At</th>
                  <th className="w-16 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, MAX_RENDER_ROWS).map((f) => {
                  const d = f.detail as Record<string, unknown>;
                  const sources = (d.sources ?? {}) as Record<string, number>;
                  const kinds = (d.kinds ?? []) as string[];
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
                        <td className="px-2 py-1.5 text-slate-400">{kinds[0] ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <span className="block max-w-40 truncate font-mono text-[10px] text-slate-400" title={foundAtLabel(f)}>
                            {foundAtLabel(f)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <CopyButton onCopy={() => void copyRow(f)} flashKey={f.id} flash={flash} label="Copy" />
                        </td>
                      </tr>
                      {open && <DetailRow finding={f} onCopyPair={copyPair} onRefresh={onRefresh} doCopy={doCopy} flash={flash} />}
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

/** Short "Found At" identifier — the most precise location available. */
function foundAtLabel(f: Finding): string {
  const d = f.detail as Record<string, unknown>;
  const evidence = (d?.evidence ?? []) as Array<{ url?: string; line?: number; column?: number }>;
  const first = evidence[0];
  if (first?.url && first.line) {
    let file = first.url;
    try {
      file = new URL(first.url).pathname.split('/').pop() || first.url;
    } catch {
      // keep raw
    }
    return `${file}:${first.line}`;
  }
  if (first?.url) {
    try {
      return new URL(first.url).pathname.split('/').pop() || first.url;
    } catch {
      return first.url;
    }
  }
  const loc = String(d?.firstPageUrl ?? f.location ?? '');
  try {
    return new URL(loc).pathname || loc;
  } catch {
    return loc.slice(0, 40);
  }
}

/** Minimal dropdown (no dependencies). Closes on outside click. */
function Dropdown({
  label,
  width,
  open,
  setOpen,
  children,
}: {
  label: string;
  width?: string;
  open?: boolean;
  setOpen?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = useState(false);
  const isOpen = open ?? internal;
  const setOpenFn = setOpen ?? setInternal;
  return (
    <span className="relative">
      <button
        onClick={() => setOpenFn(!isOpen)}
        className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 hover:text-slate-200"
      >
        {label} {isOpen ? '▴' : '▾'}
      </button>
      {isOpen && (
        <>
          <span className="fixed inset-0 z-20" onClick={() => setOpenFn(false)} />
          <div className={`absolute left-0 top-full z-30 mt-1 ${width ?? 'w-48'} rounded border border-slate-700 bg-slate-900 shadow-lg`}>
            {children}
          </div>
        </>
      )}
    </span>
  );
}

function MenuItem({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1 text-left text-[11px] hover:bg-slate-800 ${
        active ? 'text-sky-300' : 'text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

/** Expandable detail: evidence locations + interactive local value inspector + note. */
function DetailRow({
  finding,
  onCopyPair,
  onRefresh,
  doCopy,
  flash,
}: {
  finding: Finding;
  onCopyPair: (f: Finding, value: string) => void;
  onRefresh: () => void;
  doCopy: (text: string, key: string) => Promise<void>;
  flash: string | null;
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

  const evidence = (d.evidence ?? []) as Array<{ url?: string; line?: number; column?: number; snippet?: string }>;

  return (
    <tr className="border-t border-slate-800 bg-slate-800/40">
      <td colSpan={7} className="px-3 py-2">
        <div className="space-y-2 text-[11px] text-slate-300">
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

          {evidence.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-slate-500">Found At — {evidence.length} location(s)</div>
              {evidence.map((e, i) => (
                <div key={`${e.url}-${i}`} className="rounded bg-slate-900 p-1.5">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="truncate font-mono text-sky-300" title={e.url}>
                      {e.url ?? '—'}
                    </span>
                    {e.line != null && (
                      <span className="text-slate-400">
                        Line {e.line}
                        {e.column != null ? `, Column ${e.column}` : ''}
                      </span>
                    )}
                    <span
                      className="ml-auto flex gap-1"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (e.url) void doCopy(e.url, `ev-url-${i}`);
                      }}
                    >
                      <CopyButton onCopy={() => void doCopy(e.url ?? '', `ev-url-${i}`)} flashKey={`ev-url-${i}`} flash={flash} label="Copy URL" />
                      {e.line != null && (
                        <CopyButton
                          onCopy={() => void doCopy(`${e.url ?? ''}:${e.line}${e.column != null ? `,${e.column}` : ''}`, `ev-loc-${i}`)}
                          flashKey={`ev-loc-${i}`}
                          flash={flash}
                          label="Copy location"
                        />
                      )}
                    </span>
                  </div>
                  {e.snippet && (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-1 font-mono text-[10px] text-emerald-300">
                      {e.snippet}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

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
