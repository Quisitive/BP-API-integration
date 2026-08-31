// ---------------------------------------------------------------------------
// MSAL Configuration — Entra ID SPA Authentication
// ---------------------------------------------------------------------------
// Configures @azure/msal-browser for the React SPA using Authorization Code
// Flow with PKCE. Uses sessionStorage (safer for SOC tools — no persistent
// tokens if browser is left open).
//
// Required env vars (injected at build time via Vite):
//   VITE_ENTRA_CLIENT_ID   — SPA app registration client ID
//   VITE_ENTRA_TENANT_ID   — Platform tenant ID
//   VITE_ENTRA_REDIRECT_URI — Redirect URI (defaults to window.location.origin)
// ---------------------------------------------------------------------------

import { PublicClientApplication, type Configuration, LogLevel } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID || '';
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID || '';
const redirectUri = import.meta.env.VITE_ENTRA_REDIRECT_URI || window.location.origin;

const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri: redirectUri,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
    },
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

/**
 * Scopes required for API access.
 * The backend exposes an API with the app ID URI scope.
 */
export const apiScopes = {
  /** Full API access scope — matches backend app registration */
  default: [`api://${clientId}/access_as_user`],
};

/**
 * Login request configuration.
 */
export const loginRequest = {
  scopes: apiScopes.default,
};
