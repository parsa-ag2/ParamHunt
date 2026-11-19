import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  loadSettings,
  saveSettings,
  type ScopeSettings,
  type DiscoveryConfig,
} from '@shared/settings';
import { refreshDebugFlag } from '@shared/debug';

/** Options — scope editor + discovery module toggles + debug logging. */
export default function Options() {
  const [allowlist, setAllowlist] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [debug, setDebug] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryConfig>({
    jsBundles: true,
    network: true,
    cookies: true,
    storage: true,
  });
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then((s: ScopeSettings) => {
      setAllowlist((s.allowlist ?? []).join('\n'));
      setExclusions((s.exclusions ?? []).join('\n'));
      setDebug(s.debug === true);
      setDiscovery(s.discovery);
    });
  }, []);

  const save = async () => {
    try {
      await saveSettings({
        mode: 'origin',
        allowlist: splitLines(allowlist),
        exclusions: splitLines(exclusions),
        debug,
        discovery,
      });
      await refreshDebugFlag();
      setSaved('Saved — applies to new scans immediately.');
      setTimeout(() => setSaved(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleDiscovery = (key: keyof DiscoveryConfig) =>
    setDiscovery((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6 text-sm text-slate-200">
      <h1 className="text-lg font-semibold">ParamHunt — Options</h1>
      <p className="text-xs leading-5 text-slate-400">
        By default ParamHunt observes <strong>only the current site's origin</strong>. Add
        patterns (one per line) to extend the scope: <code className="text-sky-300">example.com</code>{' '}
        matches the domain and its subdomains; globs like{' '}
        <code className="text-sky-300">https://*.staging.example.com/*</code> are also supported.
        Exclusion patterns always win.
      </p>

      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase text-slate-400">Scope allowlist</span>
        <textarea
          rows={4}
          value={allowlist}
          onChange={(e) => setAllowlist(e.target.value)}
          placeholder={'api.example.com\nhttps://*.staging.example.com/*'}
          className="w-full rounded bg-slate-800 p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-sky-600"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase text-slate-400">Exclusions (always win)</span>
        <textarea
          rows={3}
          value={exclusions}
          onChange={(e) => setExclusions(e.target.value)}
          placeholder={'logout.example.com'}
          className="w-full rounded bg-slate-800 p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-sky-600"
        />
      </label>

      <fieldset className="rounded bg-slate-800 p-3">
        <legend className="px-1 text-xs font-medium uppercase text-slate-400">Discovery modules</legend>
        <p className="mb-2 text-[10px] leading-4 text-slate-500">
          Disable expensive sources if a target is very heavy — everything else keeps working.
          Defaults prioritize browser performance.
        </p>
        <div className="space-y-1.5">
          <Toggle
            checked={discovery.network}
            onChange={() => toggleDiscovery('network')}
            label="Network request observation"
            hint="webRequest metadata per request (lightweight, deduplicated)"
          />
          <Toggle
            checked={discovery.jsBundles}
            onChange={() => toggleDiscovery('jsBundles')}
            label="JavaScript bundle analysis"
            hint="fetch + static text analysis of external scripts (cached, heaviest source)"
          />
          <Toggle
            checked={discovery.cookies}
            onChange={() => toggleDiscovery('cookies')}
            label="Cookie names"
            hint="names + metadata only — values are never read"
          />
          <Toggle
            checked={discovery.storage}
            onChange={() => toggleDiscovery('storage')}
            label="Storage keys"
            hint="localStorage/sessionStorage key names + sizes only"
          />
        </div>
      </fieldset>

      <button
        onClick={() => void save()}
        className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
      >
        Save settings
      </button>
      {saved && <span className="ml-2 text-xs text-emerald-300">{saved}</span>}
      {error && <span className="ml-2 text-xs text-red-300">{error}</span>}

      <label className="mt-4 flex items-center gap-2">
        <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} className="accent-sky-500" />
        <span className="text-xs text-slate-300">
          Debug logging — pipeline stages in the service-worker and page consoles
        </span>
      </label>
    </main>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5 accent-sky-500" />
      <span>
        <span className="block text-xs text-slate-300">{label}</span>
        <span className="block text-[10px] text-slate-500">{hint}</span>
      </span>
    </label>
  );
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Mount — this was missing in earlier builds: the options page rendered blank. */
const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Options />
    </React.StrictMode>,
  );
}
