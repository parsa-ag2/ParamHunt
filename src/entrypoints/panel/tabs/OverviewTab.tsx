import React, { useEffect, useState } from 'react';
import { sendRequest } from '@core/messaging/bridge';
import type { ScopeView } from '@core/messaging/protocol';
import { useSiteFindings, useDevtoolsTabId, useScope } from '../hooks';
import { Badge, Empty } from '../ui';

/** Overview — real counters from every store; nothing fabricated. */
export default function OverviewTab({ origin }: { origin: string }) {
  const tabId = useDevtoolsTabId();
  const scope: ScopeView | null = useScope(tabId);
  const { page } = useSiteFindings(origin, { limit: 1000 });
  const [urlsTotal, setUrlsTotal] = useState<number | null>(null);
  const [endpointsTotal, setEndpointsTotal] = useState<number | null>(null);
  const [cookieCount, setCookieCount] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      if (tabId == null) return;
      try {
        const [urls, endpoints] = await Promise.all([
          sendRequest<{ total: number }>({ type: 'urls/query', ...(origin ? { origin } : {}) }),
          sendRequest<{ total: number }>({ type: 'endpoints/query', ...(origin ? { origin } : {}) }),
        ]);
        setUrlsTotal(urls.total);
        setEndpointsTotal(endpoints.total);
      } catch {
        setUrlsTotal(null);
      }
    })();
  }, [tabId, origin, page?.total]);

  useEffect(() => {
    if (tabId == null || !scope?.inScope || !scope.origin) {
      setCookieCount(null);
      return;
    }
    void sendRequest<{ cookies: unknown[] }>({ type: 'cookies/query', tabId })
      .then((r) => setCookieCount(r.cookies.length))
      .catch(() => setCookieCount(null));
  }, [tabId, scope?.inScope, scope?.origin, page?.total]);

  const bySource: Record<string, number> = {};
  for (const f of page?.items ?? []) {
    const sources = (f.detail as Record<string, unknown>)?.sources as Record<string, number> | undefined;
    for (const [s, n] of Object.entries(sources ?? {})) bySource[s] = (bySource[s] ?? 0) + n;
  }
  const lastSeen = (page?.items ?? []).reduce<string | null>(
    (m, f) => (m && m >= f.lastSeenAt ? m : f.lastSeenAt),
    null,
  );

  if (!scope) return <Empty label="Loading…" />;

  return (
    <div className="space-y-3 p-3 text-xs text-slate-300">
      <div className="flex items-center gap-2">
        <Badge tone={scope.inScope ? 'ok' : 'bad'} title={`scope: ${scope.reason}`}>
          {scope.inScope ? 'in scope' : 'out of scope'}
        </Badge>
        <span className="truncate text-slate-400" title={scope.origin}>{scope.origin || 'no tab URL'}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Parameters (site)" value={page ? page.total : null} />
        <Stat label="URLs observed" value={urlsTotal} />
        <Stat label="Endpoints discovered" value={endpointsTotal} />
        <Stat label="Cookies (metadata)" value={cookieCount} />
      </div>

      {lastSeen && (
        <p className="text-slate-500">latest observation: {new Date(lastSeen).toLocaleString()}</p>
      )}

      {Object.keys(bySource).length > 0 && (
        <div className="rounded bg-slate-800 p-2">
          <div className="mb-1 text-[10px] uppercase text-slate-500">Parameters by source</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(bySource).map(([s, n]) => (
              <Badge key={s} tone="info">{s}: {n}</Badge>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded bg-slate-800 p-2">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-sky-300">{value ?? '…'}</div>
    </div>
  );
}
