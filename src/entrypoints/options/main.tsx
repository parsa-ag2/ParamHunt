import React from 'react';
import ReactDOM from 'react-dom/client';
import '@shared/ui.css';

/** Options page — module toggles + scope allowlist + export prefs (roadmap M9). */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="space-y-2 p-4 text-sm text-slate-100">
      <h1 className="text-lg font-semibold">ParamHunt — Options</h1>
      <p className="text-xs text-slate-400">Skeleton — settings per roadmap M9.</p>
    </main>
  </React.StrictMode>,
);
