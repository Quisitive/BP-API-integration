// ---------------------------------------------------------------------------
// Routes — Audit Review
// ---------------------------------------------------------------------------
// Provides read access to the audit trail for SOC governance and compliance.
// Supports filtering by incident, proposal, actor, and time range.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRepository } from '../../storage/factory.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';
import { newAuditEvent } from '../../storage/repository.js';

const router = Router({ mergeParams: true });

/**
 * POST /api/tenants/:alias/unified/audit
 * Record an audit event.
 * Body: { incidentId, actor, action, details? }
 */
router.post('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const { incidentId, actor, action, details } = req.body as {
    incidentId?: string;
    actor?: string;
    action?: string;
    details?: Record<string, unknown>;
  };

  if (!incidentId || !actor || !action) {
    res.status(400).json({ error: 'incidentId, actor, and action are required' });
    return;
  }

  try {
    const event = newAuditEvent({
      tenantAlias: tenant.alias,
      incidentId,
      actor,
      action,
      details: details || {},
    });

    await getRepository().addAuditEvent(event);
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save audit event', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/unified/audit
 * List audit events. ?incidentId=...&actor=...&limit=100
 */
router.get('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const incidentId = req.query.incidentId as string | undefined;
  const actor = req.query.actor as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;

  try {
    let events = await getRepository().listAuditEvents(tenant.alias, incidentId);

    if (actor) {
      events = events.filter((e) => e.actor === actor);
    }

    res.json(events.slice(0, limit));
  } catch (err) {
    res.status(500).json({ error: 'Failed to list audit events', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/unified/audit/cases
 * List local case records (synced incidents). ?limit=50
 */
router.get('/cases', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const limit = req.query.limit ? Number(req.query.limit) : 50;

  try {
    const cases = await getRepository().listCases(tenant.alias, limit);
    res.json(cases);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list cases', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/unified/audit/detections
 * List locally-stored BP detections. ?limit=50
 */
router.get('/detections', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const limit = req.query.limit ? Number(req.query.limit) : 50;

  try {
    const detections = await getRepository().listDetections(tenant.alias, limit);
    res.json(detections);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list detections', detail: (err as Error).message });
  }
});

export default router;
