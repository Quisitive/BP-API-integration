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
  tenantIsolationMiddleware,
} from './middleware/index.js';
import { createRepository } from './storage/factory.js';
import bpRoutes from './routes/bp/index.js';
import xdrRoutes from './routes/xdr/index.js';
import unifiedRoutes from './routes/unified/index.js';
import { createOnboardingRouter } from './routes/onboarding.js';

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
  console.log(`[boot] Loaded ${registry.size} tenant(s)`);

  // ---- Initialize storage backend ----
  await createRepository();
  console.log(`[boot] Storage backend ready (${process.env.STORAGE_BACKEND || 'memory'})`);

  // ---- Global middleware (applied in order) ----
  app.use(requestIdMiddleware);
  app.use(securityHeaders);
  app.use(rateLimitMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Authentication — in local dev, allow testing tenant/onboarding routes without Entra JWT.
  const publicPaths = ['/api/health', '/api/ready'];
  if (allowLocalDevNoAuth) {
    publicPaths.push('/api/tenants', '/api/onboarding');
  }
  app.use(optionalAuth(publicPaths));

  // Audit — logs all write operations
  app.use(auditMiddleware);

  // ---- Health / readiness (unauthenticated) ----
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/api/ready', (_req, res) => {
    res.json({ status: 'ready', tenants: registry.size });
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

  // ---- Serve React SPA (Vite build) ----
  app.use(express.static(STATIC_DIR));

  // SPA catch-all — return index.html for client-side routing
  app.get('*', (_req, res) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });

  // ---- Start ----
  app.listen(PORT, () => {
    console.log(`[server] Unified SOC Dashboard running on http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
