import React, { useEffect, useState } from 'react';
import { loadSettings, saveSettings, type ScopeSettings } from '@shared/settings';
import { refreshDebugFlag } from '@shared/debug';

/** Options — scope editor + debug logging toggle (persisted, enforced by both ends). */
export default function Options() {
  const [allowlist, setAllowlist] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [debug, setDebug] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then((s: ScopeSettings) => {
      setAllowlist((s.allowlist ?? []).join('\n'));
      setExclusions((s.exclusions ?? []).join('\n'));
      setDebug(s.debug === true);
    });
  }, []);

  const save = async () => {
    try {
      await saveSettings({
        mode: 'origin',
        allowlist: splitLines(allowlist),
        exclusions: splitLines(exclusions),
        debug,
      });
      await refreshDebugFlag();
      setSaved('Saved — applies to new scans immediately.');
      setTimeout(() => setSaved(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
