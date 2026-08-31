// ---------------------------------------------------------------------------
// Request ID Middleware
// ---------------------------------------------------------------------------
// Attaches a unique request ID to every incoming request for distributed
// tracing and log correlation. Uses the client-provided X-Request-Id header
// if present, otherwise generates a new UUID.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = req.headers['x-request-id'];
  const id = (typeof existing === 'string' && existing.length > 0) ? existing : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
