// ---------------------------------------------------------------------------
// Routes — CISO Executive Report
// ---------------------------------------------------------------------------
// Aggregates closeout tuning, correlation trends, trend-snapshot history and
// spike anomalies into an executive report. JSON by default; ?format=md
// returns a downloadable Markdown document.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRepository } from '../../storage/factory.js';
import { computeTuningInsights } from '../../services/tuningInsights.js';
import { computeCorrelationTrends } from '../../services/correlationTrends.js';
import { detectSnapshotAnomalies } from '../../services/snapshotAnomalies.js';
import { buildCisoReport, renderCisoReportMarkdown } from '../../services/cisoReport.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/tenants/:alias/unified/reports/ciso
 * Executive security report. Optional ?format=md for a Markdown download.
 */
router.get('/ciso', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;

  try {
    const repo = getRepository();
    const [closeouts, correlations, snapshots] = await Promise.all([
      repo.listCloseouts(tenant.alias, 1000),
      repo.listCorrelations(tenant.alias),
      repo.listTrendSnapshots(tenant.alias, 1000),
    ]);

    const report = buildCisoReport({
      tenantAlias: tenant.alias,
      tenantName: tenant.displayName,
      insights: computeTuningInsights(closeouts),
      trends: computeCorrelationTrends(correlations),
      snapshots,
      anomalies: detectSnapshotAnomalies(snapshots),
    });

    if ((req.query.format as string) === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ciso-report-${tenant.alias}.md"`);
      res.send(renderCisoReportMarkdown(report));
      return;
    }
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: 'Failed to build CISO report', detail: (err as Error).message });
  }
});

export default router;
