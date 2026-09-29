// ---------------------------------------------------------------------------
// Unified Backend Server
// ---------------------------------------------------------------------------
// Express server that combines:
//   - Blackpoint CompassOne API integration (proxied)
//   - Microsoft Defender XDR / O365 API integration
//   - Unified tenant configuration
//   - Full middleware stack (security, auth, audit, rate limiting)
//
// Port: 7071 (matching SecOps-O365-Command-Dashboard convention)
// ---------------------------------------------------------------------------

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTenants, buildTenantRegistry } from './config/loader.js';
import {
  requestIdMiddleware,
  securityHeaders,
  rateLimitMiddleware,
  optionalAuth,
  auditMiddleware,
  accessLogMiddleware,
  metricsMiddleware,
  tenantIsolationMiddleware,
} from './middleware/index.js';
import { createRepository, getRepository } from './storage/factory.js';
import { startSnapshotScheduler } from './services/trendSnapshots.js';
import { startEndpointDiscoveryScheduler } from './services/endpointDiscovery.js';
import { logger } from './utils/logger.js';
import { renderMetrics } from './utils/metrics.js';
import bpRoutes from './routes/bp/index.js';
import xdrRoutes from './routes/xdr/index.js';
import unifiedRoutes from './routes/unified/index.js';
import { createOnboardingRouter } from './routes/onboarding.js';
import { createDiscoveryRouter } from './routes/discovery.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3001', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, '../../dist'); // Vite build output

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  const app = express();
  const allowLocalDevNoAuth =
    process.env.ALLOW_LOCAL_DEV_NO_AUTH === 'true' || process.env.NODE_ENV !== 'production';

  // ---- Load tenant configuration ----
  const tenants = await loadTenants();
  const registry = buildTenantRegistry(tenants);
  logger.info('boot.tenants_loaded', { count: registry.size });

  // ---- Initialize storage backend ----
  await createRepository();
  logger.info('boot.storage_ready', { backend: process.env.STORAGE_BACKEND || 'memory' });

  // ---- Global middleware (applied in order) ----
  app.use(requestIdMiddleware);
  app.use(securityHeaders);
  app.use(metricsMiddleware);
  app.use(rateLimitMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Authentication — in local dev, allow testing tenant/onboarding routes without Entra JWT.
  const publicPaths = ['/api/health', '/api/ready', '/api/metrics'];
  if (allowLocalDevNoAuth) {
    publicPaths.push('/api/tenants', '/api/onboarding');
  }
  app.use(optionalAuth(publicPaths));

  // Audit — logs all write operations
  app.use(auditMiddleware);

  // Access log — records API reads for forensics
  app.use(accessLogMiddleware);

  // ---- Health / readiness (unauthenticated) ----
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/api/ready', async (_req, res) => {
    // Probe the storage backend so orchestrators get a truthful signal
    // instead of a constant "ready".
    try {
      await getRepository().listCases('__healthcheck__', 1);
      res.json({ status: 'ready', tenants: registry.size, storage: 'ok' });
    } catch (err) {
      logger.error('ready.storage_unavailable', { error: (err as Error).message });
      res.status(503).json({ status: 'not-ready', storage: 'unavailable' });
    }
  });

  // ---- Prometheus metrics (unauthenticated) ----
  app.get('/api/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(renderMetrics());
  });

  // ---- Tenant-scoped routes ----
  const tenantRouter = express.Router({ mergeParams: true });
  tenantRouter.use(tenantIsolationMiddleware(registry));

  // Blackpoint CompassOne API routes
  tenantRouter.use('/bp', bpRoutes);

  // Microsoft Defender XDR routes
  tenantRouter.use('/xdr', xdrRoutes);

  // Unified correlation, triage, closeout, and audit routes
  tenantRouter.use('/unified', unifiedRoutes);

  app.use('/api/tenants/:alias', tenantRouter);

  // ---- Global API routes ----
  app.get('/api/tenants', (_req, res) => {
    // Return tenant summaries (no secrets)
    const summaries = [...registry.values()].map(t => ({
      alias: t.alias,
      displayName: t.displayName,
      enabled: t.enabled,
      hasBlackpoint: !!t.blackpoint,
      hasMicrosoft: !!t.microsoft,
      tags: t.tags,
    }));
    res.json(summaries);
  });

  // ---- Onboarding API (client + O365 tenant setup) ----
  app.use('/api/onboarding', createOnboardingRouter(registry));

  // ---- Capability discovery (which BP endpoints are now readable) ----
  app.use('/api/discovery', createDiscoveryRouter(registry));

  // ---- Serve React SPA (Vite build) ----
  app.use(express.static(STATIC_DIR));

  // SPA catch-all — return index.html for client-side routing
  app.get('*', (_req, res) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });

  // ---- Start ----
  app.listen(PORT, () => {
    logger.info('server.listening', { port: PORT, url: `http://localhost:${PORT}` });
  });

  // Optional periodic trend-snapshot capture (gated by ENABLE_TREND_SNAPSHOTS=true)
  startSnapshotScheduler(registry);

  // Optional periodic BP endpoint discovery (gated by ENABLE_ENDPOINT_DISCOVERY=true)
  startEndpointDiscoveryScheduler(registry);
}

main().catch(err => {
  logger.error('server.fatal_startup', { error: (err as Error).message });
  process.exit(1);
});
