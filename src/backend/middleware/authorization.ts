// ---------------------------------------------------------------------------
// Authorization Middleware — Role-Based Access Control (RBAC)
// ---------------------------------------------------------------------------
// Maps Entra ID app roles to an internal permission model:
//
//   SOC.Admin   → admin   (full access: read, write, delete, manage)
//   SOC.Analyst → analyst (read + write + limited management)
//   (default)   → viewer  (read-only)
//
// Usage:
//   router.post('/action', requirePermission('write'), handler);
//   router.delete('/item', requirePermission('delete'), handler);
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthzRequest = Request & { user?: { roles: string[] } };

export type InternalRole = 'admin' | 'analyst' | 'viewer';
export type Permission = 'read' | 'write' | 'delete' | 'manage';

const ROLE_PERMISSIONS: Record<InternalRole, Permission[]> = {
  admin: ['read', 'write', 'delete', 'manage'],
  analyst: ['read', 'write'],
  viewer: ['read'],
};

const ENTRA_ROLE_MAP: Record<string, InternalRole> = {
  'SOC.Admin': 'admin',
  'SOC.Analyst': 'analyst',
  'SOC.Viewer': 'viewer',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the highest-privilege internal role from Entra app roles.
 * If no recognized roles are present, defaults to 'viewer'.
 */
export function resolveRole(entraRoles: string[]): InternalRole {
  const mapped = entraRoles
    .map(r => ENTRA_ROLE_MAP[r])
    .filter(Boolean) as InternalRole[];

  if (mapped.includes('admin')) return 'admin';
  if (mapped.includes('analyst')) return 'analyst';
  return 'viewer';
}

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: InternalRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware factory that requires the authenticated user to have
 * a specific permission. Must be placed AFTER authenticationMiddleware.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthzRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const role = resolveRole(user.roles);
    if (!hasPermission(role, permission)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: permission,
        role,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware that requires any of the specified roles.
 */
export function requireRole(...roles: InternalRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthzRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userRole = resolveRole(user.roles);
    if (!roles.includes(userRole)) {
      res.status(403).json({
        error: 'Insufficient role',
        required: roles,
        current: userRole,
      });
      return;
    }

    next();
  };
}
