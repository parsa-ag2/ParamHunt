import React, { useCallback, useMemo, useState } from 'react';import { sendRequest } from '@core/messaging/bridge';
import { useDevtoolsTabId, useScope, useSiteFindings } from './hooks';
import { Empty, Toast } from './ui';
import OverviewTab from './tabs/OverviewTab';
import ParametersTab from './tabs/ParametersTab';
import BuilderTab from './tabs/BuilderTab';
import UrlsTab from './tabs/UrlsTab';
import RequestsTab from './tabs/RequestsTab';
import CookiesTab from './tabs/CookiesTab';
import StorageTab from './tabs/StorageTab';
import FindingsTab from './tabs/FindingsTab';
import SourcesTab from './tabs/SourcesTab';

/**
 * Panel shell — tabbed workbench (dark, DevTools-consistent):
 * Overview · Parameters · URLs · Requests · Cookies · Storage · Findings
 * Export downloads the site's findings as JSON (real collected data only).
 */

const TABS = ['Overview', 'Parameters', 'Builder', 'URLs', 'Requests', 'Cookies', 'Storage', 'Findings', 'Sources'] as const;
type Tab = (typeof TABS)[number];

export default function Panel() {
  const tabId = useDevtoolsTabId();
  const scope = useScope(tabId);
  const origin = scope?.inScope ? scope.origin : '';
  const { page: siteFindings, error: findingsError, refresh } = useSiteFindings(origin, { limit: 1000 });
  const [tab, setTab] = useState<Tab>('Overview');
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  /** Seed handed to the Parameter Builder when a group presses Build Query. */
  const [builderSeed, setBuilderSeed] = useState<{ names: string[]; baseUrl: string } | null>(null);
  const buildForGroup = useCallback(
    (names: string[], path: string) => {
      setBuilderSeed({ names, baseUrl: origin ? `${origin}${path}` : '' });
      setTab('Builder');
    },
    [origin],
  );

  const exportJson = async () => {
    try {
      const [urls, requests] = await Promise.all([
        sendRequest<{ urls: unknown[] }>({ type: 'urls/query', ...(origin ? { origin } : {}) }),
        sendRequest<{ requests: unknown[] }>({ type: 'http/query', ...(origin ? { origin } : {}) }),
      ]);
      const payload = {
        tool: 'ParamHunt',
        version: '0.2.0',
        exportedAt: new Date().toISOString(),
        origin,
        parameters: siteFindings?.items ?? [],
        urls: urls.urls,
        requests: requests.requests,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `paramhunt-${origin.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_') || 'session'}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setExportMsg('JSON exported');
      setTimeout(() => setExportMsg(null), 2000);
    } catch (err) {
      setExportMsg(`export failed: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setExportMsg(null), 3000);
    }
  };

  const body = useMemo(() => {
    switch (tab) {
      case 'Overview':
        return <OverviewTab origin={origin} />;
      case 'Parameters':
        return (
          <ParametersTab page={siteFindings} error={findingsError} onRefresh={refresh} onBuildQuery={buildForGroup} />
        );
      case 'Builder':
        return <BuilderTab page={siteFindings} origin={origin} seed={builderSeed} />;
      case 'URLs':
        return <UrlsTab origin={origin} />;
      case 'Requests':
        return <RequestsTab origin={origin} tabId={tabId} />;
      case 'Cookies':
        return <CookiesTab origin={origin} tabId={tabId} />;
      case 'Storage':
        return <StorageTab tabId={tabId} />;
      case 'Findings':
        return <FindingsTab page={siteFindings} error={findingsError} onRefresh={refresh} />;
      case 'Sources':
        return <SourcesTab page={siteFindings} />;
      default:
        return <Empty label="unknown tab" />;
    }
  }, [tab, tabId, origin, siteFindings, findingsError, refresh]);

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-200">
      {/* header */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-3 py-1.5">
        <img src="/icons/icon-32.png" alt="" className="h-4 w-4 rounded" />
        <h1 className="text-sm font-semibold text-slate-100">ParamHunt</h1>
        {scope && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
              scope.inScope ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
            }`}
            title={`scope: ${scope.reason}`}
          >
            {scope.inScope ? 'in scope' : 'out of scope'}
          </span>
        )}
        {scope?.origin ? (
          <span className="truncate text-xs text-slate-400" title={scope.origin}>
            {scope.origin}
          </span>
        ) : null}
        <button
          onClick={() => void exportJson()}
          disabled={(siteFindings?.total ?? 0) === 0}
          className="ml-auto rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
        >
          {exportMsg ?? 'Export JSON'}
        </button>
      </header>

      {/* tab navigation */}
      <nav className="flex border-b border-slate-700 bg-slate-900/60 text-xs">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 ${
              tab === t ? 'border-b-2 border-sky-500 font-medium text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {body}
    </div>
  );
}
