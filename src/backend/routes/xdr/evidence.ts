// ---------------------------------------------------------------------------
// Routes — Defender XDR Evidence
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { DefenderApiClient } from '../../services/defenderApi.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';

const router = Router({ mergeParams: true });
const defender = new DefenderApiClient();

/**
 * GET /api/tenants/:alias/xdr/evidence/:incidentId
 * Get evidence links (deep-link URLs) for an incident
 */
router.get('/:incidentId', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const links = await defender.getIncidentEvidenceLinks(tenant, req.params.incidentId);
    res.json(links);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch evidence links', detail: (err as Error).message });
  }
});

export default router;
