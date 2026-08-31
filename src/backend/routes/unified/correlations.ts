// ---------------------------------------------------------------------------
// Routes — Cross-Source Correlation
// ---------------------------------------------------------------------------
// Manages correlation records linking Blackpoint detections to Defender XDR
// incidents. Supports manual analyst-confirmed links and automated entity/
// temporal/title-based correlations.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRepository } from '../../storage/factory.js';
import { computeCorrelationTrends } from '../../services/correlationTrends.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';
import type { DetectionCorrelation } from '../../types.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/tenants/:alias/unified/correlations
 * List all correlations for this tenant
 */
router.get('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const correlations = await getRepository().listCorrelations(tenant.alias);
    res.json(correlations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list correlations', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/unified/correlations/trends
 * Cross-source correlation trends (volume by week, type mix, corroboration).
 */
router.get('/trends', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const correlations = await getRepository().listCorrelations(tenant.alias);
    res.json(computeCorrelationTrends(correlations));
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute correlation trends', detail: (err as Error).message });
  }
});

/**
 * POST /api/tenants/:alias/unified/correlations
 * Create a new correlation link.
 * Body: { bpDetectionId, xdrIncidentId, correlationType, confidence }
 */
router.post('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const { bpDetectionId, xdrIncidentId, correlationType, confidence } = req.body;

  if (!bpDetectionId || !xdrIncidentId || !correlationType) {
    res.status(400).json({ error: 'bpDetectionId, xdrIncidentId, and correlationType are required' });
    return;
  }

  const correlation: DetectionCorrelation = {
    id: crypto.randomUUID(),
    tenantAlias: tenant.alias,
    bpDetectionId,
    xdrIncidentId,
    correlationType,
    confidence: confidence ?? 0.5,
    createdAt: new Date().toISOString(),
  };

  try {
    await getRepository().saveCorrelation(correlation);
    res.status(201).json(correlation);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save correlation', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/unified/correlations/by-detection/:detectionId
 * Get correlations linked to a specific BP detection
 */
router.get('/by-detection/:detectionId', async (req: Request, res: Response) => {
  try {
    const correlations = await getRepository().getCorrelationsByDetection(req.params.detectionId);
    res.json(correlations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch correlations', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/unified/correlations/by-incident/:incidentId
 * Get correlations linked to a specific XDR incident
 */
router.get('/by-incident/:incidentId', async (req: Request, res: Response) => {
  try {
    const correlations = await getRepository().getCorrelationsByIncident(req.params.incidentId);
    res.json(correlations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch correlations', detail: (err as Error).message });
  }
});

export default router;
