import React, { useEffect, useMemo, useState } from 'react';
import type { FindingPage } from '@shared/types/finding';
import { paramName } from '@modules/param-discovery/lib/format';
import { buildOutput, type BuilderPair, type OutputFormat } from '@modules/param-discovery/lib/builder';
import { Chip, CopyButton, Empty, Toast, useCopyFlash } from '../ui';

/**
 * Parameter Builder — select discovered parameters, assign values (bulk or
 * per-parameter), preview the generated output live in several formats.
 * Everything stays local until copied; nothing is sent anywhere.
 *
 * `seed` comes from a "Build Query" action on a URL group: it pre-selects
 * the group's parameters and sets the base URL.
 */

const FORMATS: { id: OutputFormat; label: string }[] = [
  { id: 'query', label: 'Query string (?a=1&b=2)' },
  { id: 'raw', label: 'Without ?' },
  { id: 'lines', label: 'name=value lines' },
  { id: 'json', label: 'JSON' },
  { id: 'url', label: 'Complete URL' },
];

export interface BuilderSeed {
  names: string[];
  baseUrl: string;
}

export default function BuilderTab({
  page,
  origin,
  seed,
}: {
  page: FindingPage | null;
  origin: string;
  seed?: BuilderSeed | null;
}) {
  const items = page?.items ?? [];

  // selection
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | string>('all');

  // values
  const [bulkValue, setBulkValue] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState(origin ? `${origin}/` : '');
  const [format, setFormat] = useState<OutputFormat>('query');
  const [flash, copyError, doCopy] = useCopyFlash();

  const filtered = useMemo(() => {
    let out = items;
    if (sourceFilter !== 'all') {
      out = out.filter((f) => {
        const sources = (f.detail as Record<string, unknown>)?.sources as Record<string, number> | undefined;
        return sources ? Object.keys(sources).includes(sourceFilter) : false;
      });
    }
    const needle = search.trim().toLowerCase();
    if (needle) out = out.filter((f) => paramName(f).toLowerCase().includes(needle));
    return out;
  }, [items, search, sourceFilter]);

  /** Selected pairs in display order, values = user value ?? observed sample. */
  const selectedPairs = useMemo((): BuilderPair[] => {
    return items
      .filter((f) => selectedNames.has(paramName(f).toLowerCase()))
      .map((f) => {
        const name = paramName(f);
        const d = f.detail as Record<string, unknown>;
        const sample = typeof d.firstSample === 'string' ? d.firstSample : '';
        return { name, value: values[name] ?? sample ?? '' };
      });
  }, [items, selectedNames, values]);

  const output = useMemo(
    () => buildOutput(selectedPairs, format, { baseUrl }),
    [selectedPairs, format, baseUrl],
  );

  // Build Query on a URL group seeds the selection + base URL (spec §3)
  useEffect(() => {
    if (!seed || seed.names.length === 0) return;
    setSelectedNames(new Set(seed.names.map((n) => n.toLowerCase())));
    if (seed.baseUrl) setBaseUrl(seed.baseUrl);
  }, [seed]);

  const toggle = (name: string) => {
    const key = name.toLowerCase();
    setSelectedNames((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };
  const selectAll = () => setSelectedNames(new Set(items.map((f) => paramName(f).toLowerCase())));
  const selectNone = () => setSelectedNames(new Set());
  const setAllValues = (v: string) => {
    setBulkValue(v);
    setValues((prev) => {
      const n = { ...prev };
      for (const name of selectedNames) n[name] = v;
      return n;
    });
  };

  const sources = useMemo(() => {
    const s = new Set<string>();
    for (const f of items) {
      const srcs = (f.detail as Record<string, unknown>)?.sources as Record<string, number> | undefined;
      for (const src of Object.keys(srcs ?? {})) s.add(src);
    }
    return ['all', ...s];
  }, [items]);

  if (items.length === 0) {
    return <Empty label={'No discovered parameters to build from yet.\nBrowse the target site first — then select parameters here\nand assign values.'} />;
  }

  return (
    <div className="flex h-full">
      {/* left: selection list */}
      <div className="flex w-72 flex-col border-r border-slate-700">
        <div className="border-b border-slate-700 px-2 py-1.5 text-[10px] uppercase text-slate-500">
          Parameters ({selectedNames.size} selected of {items.length})
        </div>
        <div className="flex flex-wrap gap-1 px-2 py-1">
          <Chip onClick={selectAll}>Select All</Chip>
          <Chip onClick={selectNone}>None</Chip>
          {sources.map((s) => (
            <Chip key={s} active={sourceFilter === s} onClick={() => setSourceFilter(s)}>
              {s}
            </Chip>
          ))}
        </div>
        <div className="px-2 pb-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full rounded bg-slate-800 px-2 py-1 text-xs outline-none placeholder:text-slate-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((f) => {
            const name = paramName(f);
            const key = name.toLowerCase();
            const d = f.detail as Record<string, unknown>;
            const srcs = Object.keys((d.sources ?? {}) as Record<string, number>).join(', ');
            return (
              <label key={f.id} className="flex cursor-pointer items-center gap-2 border-t border-slate-800 px-2 py-1 text-xs hover:bg-slate-800/60">
                <input
                  type="checkbox"
                  checked={selectedNames.has(key)}
                  onChange={() => toggle(name)}
                  className="accent-sky-500"
                />
                <span className="truncate font-mono text-sky-300">{name}</span>
                <span className="ml-auto text-[9px] uppercase text-slate-500">{srcs}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* right: values + preview */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="space-y-2 border-b border-slate-700 p-3 text-xs">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase text-slate-500">
              Value for selected parameters ({selectedNames.size}) — bulk assign
            </span>
            <input
              value={bulkValue}
              onChange={(e) => setAllValues(e.target.value)}
              disabled={selectedNames.size === 0}
              placeholder="e.g. parsa"
              className="w-64 rounded bg-slate-800 px-2 py-1 font-mono outline-none focus:ring-1 focus:ring-sky-600 disabled:opacity-50"
            />
          </label>

          <div className="space-y-1">
            <span className="text-[10px] uppercase text-slate-500">Individual values (observed sample shown when untouched)</span>
            {selectedPairs.length === 0 ? (
              <p className="text-slate-500">Select parameters on the left.</p>
            ) : (
              selectedPairs.map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="w-44 truncate font-mono text-sky-300" title={p.name}>
                    {p.name}
                  </span>
                  <span className="text-slate-500">=</span>
                  <input
                    value={values[p.name] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                    placeholder={`observed: ${(items.find((f) => paramName(f) === p.name)?.detail as Record<string, unknown>)?.firstSample ?? '—'}`}
                    className="flex-1 rounded bg-slate-800 px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-sky-600"
                  />
                </div>
              ))
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase text-slate-500">Base URL (for the Complete URL output)</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://target.example.com/path"
              className="w-96 rounded bg-slate-800 px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-sky-600"
            />
          </label>

          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => (
              <Chip key={f.id} active={format === f.id} onClick={() => setFormat(f.id)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex-1 p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] uppercase text-slate-500">Live output</span>
            <CopyButton onCopy={() => void doCopy(output, 'out')} flashKey="out" flash={flash} label="Copy output" disabled={!output} />
            <span className="text-[10px] text-slate-500">stays local — nothing is sent by the Builder</span>
          </div>
          <pre className="min-h-24 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-800 p-2 font-mono text-[11px] text-emerald-300">
            {output || '—'}
          </pre>
          <p className="mt-1 text-[10px] text-slate-500">
            Encoding: encodeURIComponent, spaces as +. Duplicate names are merged (last value wins, first spelling shown).
            Empty values are emitted as name=.
          </p>
        </div>
      </div>
    </div>
  );
}
