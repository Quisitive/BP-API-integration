// ---------------------------------------------------------------------------
// Routes — Blackpoint Assets
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { CompassOneClient } from '../../services/compassOneClient.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';

const router = Router({ mergeParams: true });
const client = new CompassOneClient();

/**
 * GET /api/tenants/:alias/bp/assets
 * List assets. Optional ?page=1&pageSize=50
 */
router.get('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const page = req.query.page ? Number(req.query.page) : undefined;
  const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;

  try {
    const data = await client.listAssets(tenant, { page, pageSize });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch assets', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/assets/count
 * Get total asset count for the tenant
 */
router.get('/count', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const count = await client.getAssetCount(tenant);
    res.json({ count });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch asset count', detail: (err as Error).message });
  }
});

export default router;
