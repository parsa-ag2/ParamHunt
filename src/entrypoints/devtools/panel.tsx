import React from 'react';
import ReactDOM from 'react-dom/client';
import '@shared/ui.css';

/**
 * DevTools Panel App — findings browser skeleton.
 * Full findings table / filters / export land in roadmap M2/M7/M8.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="space-y-2 p-3 text-sm text-slate-100">
      <h1 className="text-base font-semibold">ParamHunt — findings</h1>
      <p className="text-xs text-slate-400">Panel skeleton — implementation per roadmap.</p>
    </main>
  </React.StrictMode>,
);
