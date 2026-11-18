import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@shared/ui.css';

/** Panel entry — WXT builds this as panel.html (registered into DevTools by devtools.ts). */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
