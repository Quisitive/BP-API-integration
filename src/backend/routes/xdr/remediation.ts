// ---------------------------------------------------------------------------
// Routes — Defender XDR Remediation
// ---------------------------------------------------------------------------

import { Router } from 'express';
import type { Request, Response } from 'express';
import { RemediationService } from '../../services/remediationService.js';
import { McpBridgeExecutor } from '../../services/mcpBridge.js';
import { LearningPlaybookEngine } from '../../services/learningPlaybook.js';
import { getRepository } from '../../storage/factory.js';
import type { UnifiedTenantConfig } from '../../config/tenants.schema.js';
import type { ApprovalDecision, MitigationRecommendation } from '../../types.js';

const router = Router({ mergeParams: true });
const executor = new McpBridgeExecutor();
const playbookEngine = new LearningPlaybookEngine();

// Lazy-init remediation service (needs repo to be ready)
let remediationService: RemediationService | null = null;
function getRemediationService(): RemediationService {
  if (!remediationService) {
    remediationService = new RemediationService(getRepository(), executor);
  }
  return remediationService;
}

/**
 * POST /api/tenants/:alias/xdr/remediation/plan
 * Create a remediation plan for an incident.
 * Body: { incidentId, recommendations?: MitigationRecommendation[] }
 */
router.post('/plan', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const { incidentId, recommendations } = req.body as {
    incidentId: string;
    recommendations?: MitigationRecommendation[];
  };

  if (!incidentId) {
    res.status(400).json({ error: 'incidentId is required' });
    return;
  }

  try {
    const repo = getRepository();
    const caseRecord = await repo.getCase(tenant.alias, incidentId);
    if (!caseRecord) {
      res.status(404).json({ error: 'Incident case not found. Sync incidents first.' });
      return;
    }

    // Use provided recommendations or auto-generate from playbook engine
    const recs = recommendations ?? playbookEngine.recommend({
      title: caseRecord.title,
      severity: caseRecord.severity,
      workloads: caseRecord.workloads,
    });

    const actor = (req as unknown as { user?: { name?: string } }).user?.name || 'system';
    const proposals = await getRemediationService().createPlan(actor, tenant.alias, caseRecord, recs);
    res.status(201).json(proposals);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create remediation plan', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/xdr/remediation/proposals
 * List proposals. Optional ?incidentId=...
 */
router.get('/proposals', async (req: Request, res: Response) => {
  const tenant = req.tenant as UnifiedTenantConfig;
  const incidentId = req.query.incidentId as string | undefined;

  try {
    const proposals = await getRemediationService().listProposals(tenant.alias, incidentId);
    res.json(proposals);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list proposals', detail: (err as Error).message });
  }
});

/**
 * GET /api/tenants/:alias/xdr/remediation/proposals/:proposalId
 * Get a single proposal
 */
router.get('/proposals/:proposalId', async (req: Request, res: Response) => {
  try {
    const proposal = await getRemediationService().getProposal(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }
    res.json(proposal);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch proposal', detail: (err as Error).message });
  }
});

/**
 * POST /api/tenants/:alias/xdr/remediation/proposals/:proposalId/decide
 * Approve or reject a proposal.
 * Body: { approved: boolean, reason?: string }
 */
router.post('/proposals/:proposalId/decide', async (req: Request, res: Response) => {
  const { approved, reason } = req.body as { approved: boolean; reason?: string };

  if (typeof approved !== 'boolean') {
    res.status(400).json({ error: 'approved (boolean) is required' });
    return;
  }

  const actor = (req as unknown as { user?: { name?: string } }).user?.name || 'system';
  const decision: ApprovalDecision = { approved, actor, reason };

  try {
    const result = await getRemediationService().applyApprovalDecision(
      req.params.proposalId,
      decision,
    );

    // Feed back to playbook engine
    playbookEngine.recordFeedback(result.id, approved);

    res.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes('not found') ? 404 : msg.includes('not pending') ? 409 : 500;
    res.status(status).json({ error: msg });
  }
});

export default router;
