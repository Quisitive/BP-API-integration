// ---------------------------------------------------------------------------
// Routes — After Action Reports (Incident Case Write-Up)
// ---------------------------------------------------------------------------
// Lets a SOC analyst generate a draft After Action Report by aggregating
// Blackpoint detections/alerts and Defender XDR incidents/alerts, edit it,
// finalize it, and export it as Markdown or printable HTML.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRepository } from '../../storage/factory.js';
import { newAuditEvent } from '../../storage/repository.js';
import { AarGenerator } from '../../services/aarGenerator.js';
import { renderReportMarkdown, renderReportHtml } from '../../services/aarFormatter.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';
import type { AfterActionReport, GenerateAarRequest } from '../../types.js';

const router = Router({ mergeParams: true });
const generator = new AarGenerator();

/**
 * GET /api/tenants/:alias/unified/reports
 * List After Action Reports. ?limit=50
 */
router.get('/', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  try {
    const reports = await getRepository().listReports(tenant.alias, limit);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list reports', detail: (err as Error).message });
  }
});

/**
 * POST /api/tenants/:alias/unified/reports/generate
 * Aggregate sources and persist a DRAFT report.
 * Body: { authoredBy, title?, xdrIncidentIds?, bpDetectionIds? }
 */
router.post('/generate', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const body = req.body as GenerateAarRequest;

  if (!body.authoredBy) {
    res.status(400).json({ error: 'authoredBy is required' });
    return;
  }
  const xdrIncidentIds = body.xdrIncidentIds ?? [];
  const bpDetectionIds = body.bpDetectionIds ?? [];
  if (xdrIncidentIds.length === 0 && bpDetectionIds.length === 0) {
    res.status(400).json({ error: 'At least one xdrIncidentId or bpDetectionId is required' });
    return;
  }

  try {
    const report = await generator.generate({
      tenant,
      authoredBy: body.authoredBy,
      title: body.title,
      xdrIncidentIds,
      bpDetectionIds,
    });

    const repo = getRepository();
    await repo.saveReport(report);
    await repo.addAuditEvent(
      newAuditEvent({
        tenantAlias: tenant.alias,
        incidentId: xdrIncidentIds[0] || bpDetectionIds[0] || report.id,
        actor: body.authoredBy,
        action: 'aar-generate',
        details: { reportId: report.id, xdrIncidentIds, bpDetectionIds, severity: report.severity },
      }),
    );

    res.status(201).json(report);
  } catch (err) {
    res.status(502).json({ error: 'Failed to generate report', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/unified/reports/:reportId
 */
router.get('/:reportId', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  try {
    const report = await getRepository().getReport(tenant.alias, req.params.reportId);
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load report', detail: (err as Error).message });
  }
});

/**
 * PUT /api/tenants/:alias/unified/reports/:reportId
 * Save analyst edits. Body: full AfterActionReport (immutable fields preserved).
 */
router.put('/:reportId', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  try {
    const repo = getRepository();
    const existing = await repo.getReport(tenant.alias, req.params.reportId);
    if (!existing) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    const incoming = req.body as Partial<AfterActionReport>;
    const merged: AfterActionReport = {
      ...existing,
      ...incoming,
      // Preserve immutable identity/ownership fields
      id: existing.id,
      tenantAlias: existing.tenantAlias,
      createdAt: existing.createdAt,
      authoredBy: existing.authoredBy,
      updatedAt: new Date().toISOString(),
    };

    await repo.saveReport(merged);
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save report', detail: (err as Error).message });
  }
});

/**
 * POST /api/tenants/:alias/unified/reports/:reportId/finalize
 * Mark a report final. Body: { actor }
 */
router.post('/:reportId/finalize', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const actor = (req.body?.actor as string) || 'analyst';
  try {
    const repo = getRepository();
    const existing = await repo.getReport(tenant.alias, req.params.reportId);
    if (!existing) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    const finalized: AfterActionReport = {
      ...existing,
      status: 'final',
      updatedAt: new Date().toISOString(),
    };
    await repo.saveReport(finalized);
    await repo.addAuditEvent(
      newAuditEvent({
        tenantAlias: tenant.alias,
        incidentId: existing.id,
        actor,
        action: 'aar-finalize',
        details: { reportId: existing.id },
      }),
    );
    res.json(finalized);
  } catch (err) {
    res.status(500).json({ error: 'Failed to finalize report', detail: (err as Error).message });
  }
});

/**
 * DELETE /api/tenants/:alias/unified/reports/:reportId
 */
router.delete('/:reportId', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  try {
    await getRepository().deleteReport(tenant.alias, req.params.reportId);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete report', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/unified/reports/:reportId/export?format=markdown|html
 * Returns the rendered report for download.
 */
router.get('/:reportId/export', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const format = (req.query.format as string) === 'html' ? 'html' : 'markdown';
  try {
    const report = await getRepository().getReport(tenant.alias, req.params.reportId);
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    const safeName = report.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'aar';
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.html"`);
      res.send(renderReportHtml(report));
    } else {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.md"`);
      res.send(renderReportMarkdown(report));
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to export report', detail: (err as Error).message });
  }
});

export default router;
