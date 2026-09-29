// ---------------------------------------------------------------------------
// Metrics Middleware
// ---------------------------------------------------------------------------
// Records request count, latency, and in-flight gauge per normalized route.
// Routes are normalized (tenant alias -> :alias, ids -> :id) to keep label
// cardinality bounded; non-API traffic collapses to "static".
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import { recordHttp, httpInFlightInc, httpInFlightDec } from '../utils/metrics.js';

function normalizeRoute(path: string): string {
  if (!path.startsWith('/api')) return 'static';
  return path
    .replace(/\/api\/tenants\/[^/]+/, '/api/tenants/:alias')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  httpInFlightInc();

  res.on('finish', () => {
    httpInFlightDec();
    recordHttp(req.method, normalizeRoute(req.path), res.statusCode, Date.now() - start);
  });
  res.on('close', () => {
    // Guard against connections that never emit 'finish'.
    if (!res.writableEnded) httpInFlightDec();
  });

  next();
}
