/**
 * Popup App — module dashboard skeleton (architecture phase).
 *
 * Popup lifecycle fact: it lives only while open. Treat it as a thin VIEW
 * over background state — query via bridge, never keep authoritative state.
 * Heavier browsing belongs in the DevTools panel (unlimited lifetime,
 * full-width). See docs/SYSTEM_ARCHITECTURE.md §Surfaces.
 */
export default function App() {
  return (
    <main className="w-80 space-y-3 p-3 text-sm text-slate-100">
      <header className="flex items-center gap-2">
        <h1 className="text-base font-semibold">ParamHunt</h1>
        <span className="rounded bg-slate-700 px-1.5 text-[10px] uppercase">v0.0.1</span>
      </header>
      <p className="text-xs leading-5 text-slate-400">
        Architecture scaffold — modules land per roadmap M1+.
      </p>
      <section className="rounded-md bg-slate-800 p-2">
        <ul className="space-y-1 text-xs text-slate-300">
          <li>☐ http-analyzer</li>
          <li>☐ param-discovery</li>
          <li>☐ dom-inspector</li>
          <li>☐ postmessage-tracker</li>
          <li>☐ js-analyzer</li>
          <li>☐ event-monitor</li>
          <li>☐ storage-inspector</li>
          <li>☐ results-manager</li>
          <li>☐ export-engine</li>
        </ul>
      </section>
    </main>
  );
}
