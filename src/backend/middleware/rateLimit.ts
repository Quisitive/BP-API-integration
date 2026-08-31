// ---------------------------------------------------------------------------
// Rate Limit Middleware
// ---------------------------------------------------------------------------
// Sliding-window rate limiter with three tiers:
//   1. Per-IP — protects against DoS from a single source
//   2. Per-tenant — protects upstream APIs from excessive tenant polling
//   3. Per-user writes — prevents accidental bulk mutations
//
// Uses in-memory sliding window. For multi-instance deployments,
// replace with Redis-backed implementation.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';

interface SlidingWindowEntry {
  timestamps: number[];
}

const windows = new Map<string, SlidingWindowEntry>();

// Periodic cleanup to prevent memory leak — run every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  const maxAge = 120_000; // Keep entries for 2 minutes max
  for (const [key, entry] of windows) {
    entry.timestamps = entry.timestamps.filter(t => now - t < maxAge);
    if (entry.timestamps.length === 0) {
      windows.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function checkWindow(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  let entry = windows.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(key, entry);
  }

  // Remove timestamps outside current window
  entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0];
    const retryAfterMs = windowMs - (now - oldest);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    retryAfterMs: 0,
  };
}

export interface RateLimitOptions {
  perIp: { max: number; windowMs: number };
  perTenant: { max: number; windowMs: number };
  perUserWrite: { max: number; windowMs: number };
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  perIp: { max: 100, windowMs: 60_000 },
  perTenant: { max: 60, windowMs: 60_000 },
  perUserWrite: { max: 30, windowMs: 60_000 },
};

export function rateLimitMiddleware(opts: Partial<RateLimitOptions> = {}) {
  const config: RateLimitOptions = {
    perIp: { ...DEFAULT_OPTIONS.perIp, ...opts.perIp },
    perTenant: { ...DEFAULT_OPTIONS.perTenant, ...opts.perTenant },
    perUserWrite: { ...DEFAULT_OPTIONS.perUserWrite, ...opts.perUserWrite },
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. Per-IP check
    const ipKey = `ip:${getClientIp(req)}`;
    const ipResult = checkWindow(ipKey, config.perIp.max, config.perIp.windowMs);
    if (!ipResult.allowed) {
      res.status(429);
      res.setHeader('Retry-After', String(Math.ceil(ipResult.retryAfterMs / 1000)));
      res.json({ error: 'Rate limit exceeded', scope: 'ip' });
      return;
    }

    // 2. Per-tenant check (only for tenant-scoped routes)
    const alias = req.params?.alias;
    if (alias) {
      const tenantKey = `tenant:${alias}`;
      const tenantResult = checkWindow(tenantKey, config.perTenant.max, config.perTenant.windowMs);
      if (!tenantResult.allowed) {
        res.status(429);
        res.setHeader('Retry-After', String(Math.ceil(tenantResult.retryAfterMs / 1000)));
        res.json({ error: 'Rate limit exceeded', scope: 'tenant' });
        return;
      }
    }

    // 3. Per-user write check (POST/PATCH/PUT/DELETE)
    const isWrite = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
    const userId = (req as any).user?.oid;
    if (isWrite && userId) {
      const userWriteKey = `user-write:${userId}`;
      const userResult = checkWindow(userWriteKey, config.perUserWrite.max, config.perUserWrite.windowMs);
      if (!userResult.allowed) {
        res.status(429);
        res.setHeader('Retry-After', String(Math.ceil(userResult.retryAfterMs / 1000)));
        res.json({ error: 'Rate limit exceeded', scope: 'user-write' });
        return;
      }
    }

    // Set informational header
    res.setHeader('X-RateLimit-Remaining-IP', String(ipResult.remaining));
    next();
  };
}
