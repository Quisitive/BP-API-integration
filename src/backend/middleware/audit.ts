// ---------------------------------------------------------------------------
// Audit Logging Middleware
// ---------------------------------------------------------------------------
// Logs all mutating (write) operations for compliance and forensic analysis.
// Captures: who, what, when, which tenant, and the request ID for correlation.
//
// In production this would forward to a SIEM / Log Analytics workspace.
// For now, writes structured JSON to stdout for container log ingestion.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import { logger, redactPath, getClientIp } from '../utils/logger.js';

export interface AuditEntry {
  timestamp: string;
  requestId: string;
  userId: string;
  userName: string;
  method: string;
  path: string;
  tenantAlias: string | null;
  statusCode: number;
  durationMs: number;
  ip: string;
}

const AUDITABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!AUDITABLE_METHODS.has(req.method)) {
    next();
    return;
  }

  const start = Date.now();

  // Hook into response finish event
  res.on('finish', () => {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      requestId: req.requestId || 'unknown',
      userId: req.user?.oid || 'anonymous',
      userName: req.user?.preferredUsername || 'anonymous',
      method: req.method,
      path: redactPath(req.originalUrl),
      tenantAlias: req.tenant?.alias || req.params?.alias || null,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      ip: getClientIp(req),
    };

    // Structured JSON log — picked up by container logging drivers
    logger.audit({ ...entry });
  });

  next();
}
