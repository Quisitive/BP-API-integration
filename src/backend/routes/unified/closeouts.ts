// ---------------------------------------------------------------------------
// Routes — Closeout Governance
// ---------------------------------------------------------------------------
// Records and queries case closeout decisions. Links to either a BP detection
// or an XDR incident (or both via correlation). Provides governance trail
// for when cases are formally closed.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRepository } from '../../storage/factory.js';
import { newAuditEvent } from '../../storage/repository.js';
import { CompassOneClient } from '../../services/compassOneClient.js';
import { dispositionFromResolution } from '../../services/tuningInsights.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';
import type { CloseoutRecord } from '../../types.js';

const router = Router({ mergeParams: true });
const bpClient = new CompassOneClient();

/**
 * GET /api/tenants/:alias/unified/closeouts
 * List closeout records. ?limit=50
 */
router.get('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const limit = req.query.limit ? Number(req.query.limit) : 50;

  try {
    const closeouts = await getRepository().listCloseouts(tenant.alias, limit);
    res.json(closeouts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list closeouts', detail: (err as Error).message });
  }
});

/**
 * POST /api/tenants/:alias/unified/closeouts
 * Create a closeout record.
 * Body: { bpDetectionId?, xdrIncidentId?, resolution, notes?, closedBy }
 */
router.post('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const { bpDetectionId, xdrIncidentId, resolution, notes, closedBy } = req.body;

  if (!resolution || !closedBy) {
    res.status(400).json({ error: 'resolution and closedBy are required' });
    return;
  }

  if (!bpDetectionId && !xdrIncidentId) {
    res.status(400).json({ error: 'At least one of bpDetectionId or xdrIncidentId is required' });
    return;
  }

  const closeout: CloseoutRecord = {
    id: crypto.randomUUID(),
    tenantAlias: tenant.alias,
    bpDetectionId,
    xdrIncidentId,
    closedBy,
    closedAt: new Date().toISOString(),
    resolution,
    notes,
    disposition: dispositionFromResolution(resolution),
  };

  // Best-effort enrichment from the linked BP detection so tuning analytics
  // can compute per-rule false-positive rate and MTTR. Never block closeout.
  if (bpDetectionId) {
    try {
      const detection = await bpClient.getDetection(tenant, bpDetectionId);
      if (detection.alertTypes?.length) closeout.alertTypes = detection.alertTypes;
      if (detection.created) closeout.detectionCreatedAt = detection.created;
    } catch {
      // Detection lookup is optional; proceed without enrichment.
    }
  }

  try {
    const repo = getRepository();
    await repo.saveCloseout(closeout);

    // Emit audit event
    const auditEvent = newAuditEvent({
      tenantAlias: tenant.alias,
      incidentId: xdrIncidentId || bpDetectionId,
      actor: closedBy,
      action: 'closeout',
      details: { resolution, bpDetectionId, xdrIncidentId, notes },
    });
    await repo.addAuditEvent(auditEvent);

    res.status(201).json(closeout);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save closeout', detail: (err as Error).message });
  }
});

export default router;
