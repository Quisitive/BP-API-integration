// ---------------------------------------------------------------------------
// Routes — Unified Alert Snapshots
// ---------------------------------------------------------------------------
// Provides a cross-source alert timeline combining Blackpoint and Defender XDR
// alerts into a single chronological view per tenant.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRepository } from '../../storage/factory.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';
import type { AlertSnapshot } from '../../types.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/tenants/:alias/unified/alerts
 * List all alert snapshots (cross-source timeline). ?limit=100&source=blackpoint|defender-xdr
 */
router.get('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const source = req.query.source as 'blackpoint' | 'defender-xdr' | undefined;

  try {
    let snapshots = await getRepository().listAlertSnapshots(tenant.alias, limit);

    if (source) {
      snapshots = snapshots.filter((s) => s.source === source);
    }

    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list alert snapshots', detail: (err as Error).message });
  }
});

/**
 * POST /api/tenants/:alias/unified/alerts
 * Record an alert snapshot manually (e.g. from a webhook or sync job).
 * Body: AlertSnapshot (minus id and snapshotAt, which are generated)
 */
router.post('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const { source, sourceId, title, severity, status, createdAt } = req.body;

  if (!source || !sourceId || !title) {
    res.status(400).json({ error: 'source, sourceId, and title are required' });
    return;
  }

  const snapshot: AlertSnapshot = {
    id: crypto.randomUUID(),
    tenantAlias: tenant.alias,
    source,
    sourceId,
    title,
    severity: severity || 'Unknown',
    status: status || 'Active',
    createdAt: createdAt || new Date().toISOString(),
    snapshotAt: new Date().toISOString(),
  };

  try {
    await getRepository().saveAlertSnapshot(snapshot);
    res.status(201).json(snapshot);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save alert snapshot', detail: (err as Error).message });
  }
});

export default router;
