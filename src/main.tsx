// ---------------------------------------------------------------------------
// Vite SPA entry point (replaces CRA's src/index.tsx)
// ---------------------------------------------------------------------------

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

async function render() {
  if (clientId) {
    // Production: wrap with MSAL auth
    const { MsalProvider } = await import('@azure/msal-react');
    const { msalInstance } = await import('./auth/msalConfig');
    root.render(
      <React.StrictMode>
        <MsalProvider instance={msalInstance}>
          <App />
        </MsalProvider>
      </React.StrictMode>,
    );
  } else {
    // Local dev: skip auth entirely
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
}

render();
