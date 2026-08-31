// ---------------------------------------------------------------------------
// Routes — Blackpoint Reports
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { CompassOneClient } from '../../services/compassOneClient.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';

const router = Router({ mergeParams: true });
const client = new CompassOneClient();

/**
 * GET /api/tenants/:alias/bp/reports
 * List report runs. Optional ?reportType=MDR|Executive|Cloud&page=1&pageSize=20
 */
router.get('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const reportType = req.query.reportType as string | undefined;
  const page = req.query.page ? Number(req.query.page) : undefined;
  const pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;

  try {
    const data = await client.listReports(tenant, { reportType, page, pageSize });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch reports', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/reports/:reportId/pdf
 * Get a signed PDF download URL for a report
 */
router.get('/:reportId/pdf', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const url = await client.getReportPdfUrl(tenant, req.params.reportId);
    res.json({ url });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch report PDF URL', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/bp/reports/:reportId/json
 * Get report data as JSON
 */
router.get('/:reportId/json', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const data = await client.getReportJson(tenant, req.params.reportId);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch report JSON', detail: (err as Error).message });
  }
});

export default router;
