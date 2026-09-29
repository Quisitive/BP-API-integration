// ---------------------------------------------------------------------------
// Routes — Endpoint Discovery
// ---------------------------------------------------------------------------
// Surfaces the CompassOne capability-discovery report so reporting can see
// which not-yet-integrated BP endpoints have become available for our API key.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getDiscoveryReport,
  runDiscovery,
} from '../services/endpointDiscovery.js';
import type { UnifiedTenantConfig } from '../config/tenants.schema.js';

export function createDiscoveryRouter(registry: Map<string, UnifiedTenantConfig>): Router {
  const router = Router();

  /**
   * GET /api/discovery
   * Latest capability-discovery snapshot. Optional ?integratable=true returns
   * only available endpoints the app does not yet consume.
   */
  router.get('/', (req: Request, res: Response) => {
    const report = getDiscoveryReport();
    if (req.query.integratable === 'true') {
      res.json({
        lastRunAt: report.lastRunAt,
        integratableCount: report.integratableCount,
        endpoints: report.results.filter((r) => r.availability === 'available' && !r.integrated),
      });
      return;
    }
    res.json(report);
  });

  /**
   * POST /api/discovery/run
   * Trigger an on-demand discovery pass (does not wait for the scheduler).
   */
  router.post('/run', async (_req: Request, res: Response) => {
    try {
      const report = await runDiscovery(registry);
      res.json(report);
    } catch (err) {
      res.status(502).json({ error: 'Discovery run failed', detail: (err as Error).message });
    }
  });

  return router;
}
