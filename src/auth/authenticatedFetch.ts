// ---------------------------------------------------------------------------
// Authenticated Fetch — Automatically attaches Bearer token to API calls
// ---------------------------------------------------------------------------
// Wraps the native fetch() to acquire a fresh access token from MSAL
// before making requests to the backend API.
// ---------------------------------------------------------------------------

import { msalInstance, apiScopes } from './msalConfig';
import { InteractionRequiredAuthError } from '@azure/msal-browser';

/**
 * Fetch wrapper that silently acquires a token and attaches it.
 * Falls back to interactive login if silent acquisition fails.
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) {
    throw new Error('No authenticated account. Please log in.');
  }

  let accessToken: string;

  try {
    const response = await msalInstance.acquireTokenSilent({
      scopes: apiScopes.default,
      account: accounts[0],
    });
    accessToken = response.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      // Token expired or consent needed — trigger interactive flow
      const response = await msalInstance.acquireTokenPopup({
        scopes: apiScopes.default,
        account: accounts[0],
      });
      accessToken = response.accessToken;
    } else {
      throw error;
    }
  }

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);

  return fetch(url, {
    ...options,
    headers,
  });
}
