// ---------------------------------------------------------------------------
// Tenant Isolation Middleware
// ---------------------------------------------------------------------------
// Resolves the tenant from the :alias route param and attaches the full
// tenant config to the request. Rejects requests for disabled or unknown
// tenants before they reach route handlers.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import type { UnifiedTenantConfig } from '../config/tenants.schema.js';

declare global {
  namespace Express {
    interface Request {
      tenant?: UnifiedTenantConfig;
    }
  }
}

export type TenantRegistry = Map<string, UnifiedTenantConfig>;

/**
 * Creates middleware that resolves the current tenant from the :alias param.
 * The registry must be loaded at startup and passed in.
 */
export function tenantIsolationMiddleware(registry: TenantRegistry) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const alias = req.params.alias;

    if (!alias) {
      // Route does not have a tenant param — skip isolation
      next();
      return;
    }

    const tenant = registry.get(alias);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found', alias });
      return;
    }

    if (!tenant.enabled) {
      res.status(403).json({ error: 'Tenant is disabled', alias });
      return;
    }

    req.tenant = tenant;
    next();
  };
}
