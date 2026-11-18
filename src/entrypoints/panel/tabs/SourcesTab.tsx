import React, { useMemo, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { FindingPage } from '@shared/types/finding';
import { paramName } from '@modules/param-discovery/lib/format';
import { Badge, CopyButton, Empty, Toast, useCopyFlash } from '../ui';

/** Sources — findings grouped by discovery source; click-through to params. */
export default function SourcesTab({ page }: { page: FindingPage | null }) {
  const [flash, copyError, doCopy] = useCopyFlash();
  const [openSource, setOpenSource] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; location: string; occurrences: number }[]>();
    for (const f of page?.items ?? []) {
      const d = f.detail as Record<string, unknown>;
      const sources = (d.sources ?? {}) as Record<string, number>;
      for (const src of Object.keys(sources)) {
        const list = map.get(src) ?? [];
        list.push({
          name: paramName(f),
          location: String(d.firstPageUrl ?? f.location ?? ''),
          occurrences: f.occurrences,
        });
        map.set(src, list);
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [page]);

  if (groups.length === 0) {
    return <Empty label="No sources yet — discover parameters first." />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <Toast error={copyError} message={null} />
      <div className="space-y-2 p-3">
        {groups.map(([source, params]) => (
          <div key={source} className="rounded bg-slate-800">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
              onClick={() => setOpenSource(openSource === source ? null : source)}
            >
              <Badge tone="info">{source.toUpperCase()}</Badge>
              <span className="text-slate-300">{params.length} parameters</span>
              <span
                className="ml-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <CopyButton
                  onCopy={() => doCopy(params.map((p) => p.name).join('\n'), `src-${source}`)}
                  flashKey={`src-${source}`}
                  flash={flash}
                  label="Copy names"
                />
              </span>
            </button>
            {openSource === source && (
              <ul className="space-y-0.5 border-t border-slate-700 px-3 py-2 font-mono text-[11px]">
                {params.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="flex items-center gap-2">
                    <span className="text-sky-300">{p.name}</span>
                    <span className="truncate text-slate-500" title={p.location}>
                      {p.location}
                    </span>
                    <span className="ml-auto text-slate-500">×{p.occurrences}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
