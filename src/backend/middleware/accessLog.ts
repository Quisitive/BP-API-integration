// ---------------------------------------------------------------------------
// Access Logging Middleware
// ---------------------------------------------------------------------------
// Emits a structured access record for read requests so tenant data access is
// observable for forensics — not just mutations (those are covered by the
// audit middleware). Skips static/SPA traffic and health probes to keep the
// signal clean, and redacts secret-bearing query params before logging.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import { logger, redactPath, getClientIp } from '../utils/logger.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP_PATHS = new Set(['/api/health', '/api/ready', '/api/metrics']);

export function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only API reads: writes are recorded by the audit middleware; non-/api
  // traffic is static assets / the SPA catch-all.
  if (!req.path.startsWith('/api') || WRITE_METHODS.has(req.method) || SKIP_PATHS.has(req.path)) {
    next();
    return;
  }

  const start = Date.now();

  res.on('finish', () => {
    logger.access({
      requestId: req.requestId || 'unknown',
      userId: req.user?.oid || 'anonymous',
      userName: req.user?.preferredUsername || 'anonymous',
      method: req.method,
      path: redactPath(req.originalUrl),
      tenantAlias: req.tenant?.alias || req.params?.alias || null,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      ip: getClientIp(req),
    });
  });

  next();
}
