// ---------------------------------------------------------------------------
// ProtectedRoute — Route guard for authenticated + authorized users
// ---------------------------------------------------------------------------
// Wraps route content and checks that the user has the required role.
// Falls back to a "no access" message if the role is insufficient.
// ---------------------------------------------------------------------------

import React from 'react';
import { useMsal } from '@azure/msal-react';
import type { InternalRole } from '../backend/middleware/authorization';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: InternalRole;
}

function getRolesFromAccount(account: any): string[] {
  return account?.idTokenClaims?.roles || [];
}

function resolveClientRole(entraRoles: string[]): InternalRole {
  if (entraRoles.includes('SOC.Admin')) return 'admin';
  if (entraRoles.includes('SOC.Analyst')) return 'analyst';
  return 'viewer';
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { accounts } = useMsal();
  const account = accounts[0];

  if (!account) {
    return <div className="loading-spinner">Not authenticated</div>;
  }

  if (requiredRole) {
    const roles = getRolesFromAccount(account);
    const userRole = resolveClientRole(roles);

    const roleHierarchy: InternalRole[] = ['admin', 'analyst', 'viewer'];
    const userLevel = roleHierarchy.indexOf(userRole);
    const requiredLevel = roleHierarchy.indexOf(requiredRole);

    if (userLevel > requiredLevel) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#ef5350' }}>
          <h2>Access Denied</h2>
          <p>This page requires the <strong>{requiredRole}</strong> role.</p>
          <p>Your current role: <strong>{userRole}</strong></p>
        </div>
      );
    }
  }

  return <>{children}</>;
}
