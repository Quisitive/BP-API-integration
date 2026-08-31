// ---------------------------------------------------------------------------
// Routes — Blackpoint Analytics
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { CompassOneClient } from '../../services/compassOneClient.js';
import { getRepository } from '../../storage/factory.js';
import { computeTuningInsights } from '../../services/tuningInsights.js';
import { captureTrendSnapshot } from '../../services/trendSnapshots.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';

const router = Router({ mergeParams: true });
const client = new CompassOneClient();

/**
 * GET /api/tenants/:alias/bp/analytics/count
 * Detection count. Optional ?status=OPEN|RESOLVED
 */
router.get('/count', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const status = req.query.status as 'OPEN' | 'RESOLVED' | undefined;

  try {
    const count = await client.getDetectionCount(tenant, status);
    res.json({ count });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch detection count', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/analytics/weekly-trends
 * Alert groups aggregated by week
 */
router.get('/weekly-trends', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const data = await client.getWeeklyTrends(tenant);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch weekly trends', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/analytics/top-entities
 * Top detections by entity. Optional ?top=10
 */
router.get('/top-entities', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const top = req.query.top ? Number(req.query.top) : undefined;

  try {
    const data = await client.getTopEntities(tenant, { top });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch top entities', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/analytics/top-threats
 * Top detections by threat. Optional ?top=10
 */
router.get('/top-threats', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const top = req.query.top ? Number(req.query.top) : undefined;

  try {
    const data = await client.getTopThreats(tenant, { top });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch top threats', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/analytics/tuning-insights
 * Aggregates closeout history into alert-tuning signal: disposition mix,
 * per-rule false-positive / noise rate, MTTR, and tuning candidates.
 * Optional ?minSample=3&noiseRateThreshold=0.5
 */
router.get('/tuning-insights', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const minSample = req.query.minSample ? Number(req.query.minSample) : undefined;
  const noiseRateThreshold = req.query.noiseRateThreshold
    ? Number(req.query.noiseRateThreshold)
    : undefined;

  try {
    const closeouts = await getRepository().listCloseouts(tenant.alias, 1000);
    const insights = computeTuningInsights(closeouts, { minSample, noiseRateThreshold });
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute tuning insights', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/analytics/snapshots
 * Historical trend snapshots (long-term metric history).
 */
router.get('/snapshots', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const limit = req.query.limit ? Number(req.query.limit) : 500;

  try {
    const snapshots = await getRepository().listTrendSnapshots(tenant.alias, limit);
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list snapshots', detail: (err as Error).message });
  }
});

/**
 * POST /api/tenants/:alias/bp/analytics/snapshots
 * Capture a trend snapshot now (also runs on schedule when enabled).
 */
router.post('/snapshots', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const snapshot = await captureTrendSnapshot(tenant);
    res.status(201).json(snapshot);
  } catch (err) {
    res.status(502).json({ error: 'Failed to capture snapshot', detail: (err as Error).message });
  }
});

export default router;
