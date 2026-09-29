// ---------------------------------------------------------------------------
// Structured Logger
// ---------------------------------------------------------------------------
// Zero-dependency JSON logger for consistent, correlated, SIEM-friendly output.
// Every line is a single JSON object on stdout (or stderr for errors) so
// container log drivers / Log Analytics can ingest it without a parser.
//
// Levels are gated by LOG_LEVEL (debug < info < warn < error; default info).
// Semantic helpers (audit / access / security) tag records with a `category`
// so downstream tooling can route and alert on them independently of level.
// ---------------------------------------------------------------------------

import type { Request } from 'express';
import { incSecurityEvent } from './metrics.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const threshold =
  LEVEL_ORDER[(process.env.LOG_LEVEL as LogLevel)] ?? LEVEL_ORDER.info;

export type LogFields = Record<string, unknown>;

function write(level: LogLevel, event: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < threshold) return;
  // Logging must never throw and halt a request — swallow serialization errors.
  try {
    const record = {
      level,
      time: new Date().toISOString(),
      event,
      ...fields,
    };
    const line = JSON.stringify(record) + '\n';
    if (level === 'error') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  } catch {
    /* never let logging break the caller */
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => write('debug', event, fields),
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, fields?: LogFields) => write('error', event, fields),

  /** Compliance record for mutating operations. */
  audit: (fields: LogFields) =>
    write('info', 'http.audit', { category: 'audit', ...fields }),

  /** Access record for read operations. */
  access: (fields: LogFields) =>
    write('info', 'http.access', { category: 'access', ...fields }),

  /** Security-relevant event (auth failure, rate limit, tenant denial). */
  security: (event: string, fields?: LogFields) => {
    incSecurityEvent(event);
    write('warn', event, { category: 'security', ...fields });
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SENSITIVE_PARAM =
  /^(token|access_token|id_token|refresh_token|code|secret|client_secret|api_key|apikey|key|password|pwd|authorization|sig|signature)$/i;

/**
 * Strip secret-bearing query-string values before a URL is logged.
 * Preserves the path and non-sensitive params; replaces sensitive values
 * with `REDACTED`.
 */
export function redactPath(originalUrl: string): string {
  const qIdx = originalUrl.indexOf('?');
  if (qIdx === -1) return originalUrl;

  const pathPart = originalUrl.slice(0, qIdx);
  const params = new URLSearchParams(originalUrl.slice(qIdx + 1));

  for (const key of [...params.keys()]) {
    if (SENSITIVE_PARAM.test(key)) params.set(key, 'REDACTED');
  }

  const rebuilt = params.toString();
  return rebuilt ? `${pathPart}?${rebuilt}` : pathPart;
}

/** Best-effort client IP, honoring the first X-Forwarded-For hop. */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
