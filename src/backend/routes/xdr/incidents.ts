// ---------------------------------------------------------------------------
// Routes — Defender XDR Incidents
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { DefenderApiClient } from '../../services/defenderApi.js';
import { getRepository } from '../../storage/factory.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';
import type { CaseWritebackRequest } from '../../types.js';

const router = Router({ mergeParams: true });
const defender = new DefenderApiClient();

/**
 * GET /api/tenants/:alias/xdr/incidents
 * List incidents from Defender XDR. Optional ?top=50&filter=...
 */
router.get('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const top = req.query.top ? Number(req.query.top) : undefined;
  const filter = req.query.filter as string | undefined;

  try {
    const incidents = await defender.listIncidents(tenant, { top, filter });

    // Sync to local storage
    const repo = getRepository();
    for (const incident of incidents) {
      await repo.upsertCaseFromIncident(incident);
    }

    res.json(incidents);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch incidents from Defender XDR', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/xdr/incidents/:incidentId
 * Get a single incident
 */
router.get('/:incidentId', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const incident = await defender.getIncident(tenant, req.params.incidentId);
    await getRepository().upsertCaseFromIncident(incident);
    res.json(incident);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch incident', detail: (err as Error).message });
  }
});

/**
 * PATCH /api/tenants/:alias/xdr/incidents/:incidentId
 * Update incident (writeback to Defender)
 */
router.patch('/:incidentId', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const update: CaseWritebackRequest = req.body;

  try {
    await defender.updateIncident(tenant, req.params.incidentId, update);
    res.json({ success: true, incidentId: req.params.incidentId });
  } catch (err) {
    res.status(502).json({ error: 'Failed to update incident', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/xdr/incidents/:incidentId/cases
 * Get local case record (from storage)
 */
router.get('/:incidentId/case', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const record = await getRepository().getCase(tenant.alias, req.params.incidentId);
    if (!record) {
      res.status(404).json({ error: 'Case not found locally' });
      return;
    }
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: 'Storage error', detail: (err as Error).message });
  }
});

export default router;
