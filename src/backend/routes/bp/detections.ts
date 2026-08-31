// ---------------------------------------------------------------------------
// Routes — Blackpoint Detections (Alert Groups)
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { CompassOneClient } from '../../services/compassOneClient.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';

const router = Router({ mergeParams: true });
const client = new CompassOneClient();

/**
 * GET /api/tenants/:alias/bp/detections
 * List alert groups (detections). Supports ?status=OPEN|RESOLVED&skip=0&take=50
 */
router.get('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const status = req.query.status
    ? (Array.isArray(req.query.status) ? req.query.status as string[] : [req.query.status as string])
    : undefined;
  const skip = req.query.skip ? Number(req.query.skip) : undefined;
  const take = req.query.take ? Number(req.query.take) : undefined;

  try {
    const data = await client.listDetections(tenant, {
      status: status as Array<'OPEN' | 'RESOLVED'> | undefined,
      skip,
      take,
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch detections from CompassOne', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/detections/:detectionId
 * Get a single alert group by ID
 */
router.get('/:detectionId', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  try {
    const data = await client.getDetection(tenant, req.params.detectionId);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch detection', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/detections/:detectionId/alerts
 * List individual alerts within an alert group
 */
router.get('/:detectionId/alerts', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const skip = req.query.skip ? Number(req.query.skip) : undefined;
  const take = req.query.take ? Number(req.query.take) : undefined;

  try {
    const data = await client.getAlerts(tenant, req.params.detectionId, { skip, take });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch alerts', detail: (err as Error).message });
  }
});

export default router;
