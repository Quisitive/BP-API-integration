// ---------------------------------------------------------------------------
// Routes — Triage Engine
// ---------------------------------------------------------------------------
// Exposes the Learning Playbook Engine for recommendation scoring and
// playbook management. Used by SOC analysts for decision support.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { LearningPlaybookEngine } from '../../services/learningPlaybook.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';
import type { IncidentContext } from '../../services/learningPlaybook.js';

const router = Router({ mergeParams: true });
const playbookEngine = new LearningPlaybookEngine();

/**
 * POST /api/tenants/:alias/unified/triage/recommend
 * Get playbook recommendations for an incident context.
 * Body: IncidentContext { title, severity, workloads, alertTypes?, entities? }
 */
router.post('/recommend', async (req: Request, res: Response) => {
  const context: IncidentContext = req.body;

  if (!context.title || !context.severity || !context.workloads) {
    res.status(400).json({ error: 'title, severity, and workloads are required' });
    return;
  }

  try {
    const recommendations = playbookEngine.recommend(context);
    res.json(recommendations);
  } catch (err) {
    res.status(500).json({ error: 'Triage recommendation failed', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/unified/triage/playbooks
 * Export all playbook entries
 */
router.get('/playbooks', async (_req: Request, res: Response) => {
  try {
    const playbooks = playbookEngine.exportPlaybooks();
    res.json(playbooks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export playbooks', detail: (err as Error).message });
  }
});

/**
 * PUT /api/tenants/:alias/unified/triage/playbooks/:playbookId
 * Create or update a playbook entry
 */
router.put('/playbooks/:playbookId', async (req: Request, res: Response) => {
  try {
    const entry = { ...req.body, id: req.params.playbookId };
    playbookEngine.upsertPlaybook(entry);
    res.json({ success: true, id: req.params.playbookId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upsert playbook', detail: (err as Error).message });
  }
});

/**
 * POST /api/tenants/:alias/unified/triage/playbooks/:playbookId/feedback
 * Record approval/rejection feedback. Body: { approved: boolean }
 */
router.post('/playbooks/:playbookId/feedback', async (req: Request, res: Response) => {
  const { approved } = req.body as { approved: boolean };

  if (typeof approved !== 'boolean') {
    res.status(400).json({ error: 'approved (boolean) is required' });
    return;
  }

  try {
    playbookEngine.recordFeedback(req.params.playbookId, approved);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record feedback', detail: (err as Error).message });
  }
});

export default router;
