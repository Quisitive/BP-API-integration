// ---------------------------------------------------------------------------
// AuthProvider — MSAL React authentication wrapper
// ---------------------------------------------------------------------------
// Wraps the app with authentication state. Provides:
//   - Auto-redirect to login for unauthenticated users
//   - Loading state while auth initializes
//   - Access to current account info
// ---------------------------------------------------------------------------

import React from 'react';
import {
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
  useMsal,
} from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { loginRequest } from './msalConfig';

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { instance, inProgress } = useMsal();

  // Auto-trigger login if no account and no interaction in progress
  React.useEffect(() => {
    const accounts = instance.getAllAccounts();
    if (accounts.length === 0 && inProgress === InteractionStatus.None) {
      instance.loginRedirect(loginRequest).catch(console.error);
    }
  }, [instance, inProgress]);

  if (inProgress !== InteractionStatus.None) {
    return (
      <div className="loading-spinner">
        Authenticating...
      </div>
    );
  }

  return (
    <>
      <AuthenticatedTemplate>{children}</AuthenticatedTemplate>
      <UnauthenticatedTemplate>
        <div className="loading-spinner">
          Redirecting to login...
        </div>
      </UnauthenticatedTemplate>
    </>
  );
}
