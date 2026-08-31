// ---------------------------------------------------------------------------
// Remediation Service
// ---------------------------------------------------------------------------
// Ported from SecOps-O365-Command-Dashboard/remediationService.ts.
// Manages remediation proposal lifecycle: creation → approval → execution.
// Depends on a CaseRepository (storage) and RemediationExecutor (MCP bridge).
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type {
  IncidentSummary,
  MitigationRecommendation,
  RemediationProposal,
  ApprovalDecision,
  AuditEvent,
  ProposalStatus,
} from '../types.js';

// ---------------------------------------------------------------------------
// Interfaces for dependency injection
// ---------------------------------------------------------------------------

export interface ProposalRepository {
  saveProposal(proposal: RemediationProposal): Promise<void>;
  getProposal(proposalId: string): Promise<RemediationProposal | null>;
  listProposals(tenantAlias: string, incidentId?: string): Promise<RemediationProposal[]>;
  addAuditEvent(event: AuditEvent): Promise<void>;
}

export interface RemediationExecutor {
  execute(proposal: RemediationProposal): Promise<{ note: string }>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RemediationService {
  constructor(
    private readonly repository: ProposalRepository,
    private readonly executor: RemediationExecutor,
  ) {}

  /**
   * Create remediation proposals for an incident based on recommendations.
   */
  async createPlan(
    actor: string,
    tenantAlias: string,
    incident: IncidentSummary,
    recommendations: MitigationRecommendation[],
  ): Promise<RemediationProposal[]> {
    const proposals: RemediationProposal[] = [];

    for (const rec of recommendations) {
      const proposal: RemediationProposal = {
        proposalId: randomUUID(),
        id: rec.id,
        tenantAlias,
        incidentId: incident.id,
        title: rec.title,
        description: rec.description,
        riskLevel: rec.riskLevel,
        status: 'pending',
        mcpOperation: rec.mcpOperation,
        manualSteps: rec.manualSteps,
        createdAt: new Date().toISOString(),
      };

      await this.repository.saveProposal(proposal);
      proposals.push(proposal);

      await this.repository.addAuditEvent(newAuditEvent({
        tenantAlias,
        incidentId: incident.id,
        proposalId: proposal.proposalId,
        actor,
        action: 'proposal.created',
        details: { title: rec.title, riskLevel: rec.riskLevel },
      }));
    }

    return proposals;
  }

  /**
   * Retrieve a single proposal by ID.
   */
  async getProposal(proposalId: string): Promise<RemediationProposal | null> {
    return this.repository.getProposal(proposalId);
  }

  /**
   * List proposals for a tenant, optionally filtered by incident.
   */
  async listProposals(tenantAlias: string, incidentId?: string): Promise<RemediationProposal[]> {
    return this.repository.listProposals(tenantAlias, incidentId);
  }

  /**
   * Apply an approval or rejection decision to a proposal.
   * If approved and executor is available, execute immediately.
   */
  async applyApprovalDecision(
    proposalId: string,
    decision: ApprovalDecision,
  ): Promise<RemediationProposal> {
    const proposal = await this.repository.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }
    if (proposal.status !== 'pending') {
      throw new Error(`Proposal ${proposalId} is not pending (current: ${proposal.status})`);
    }

    const newStatus: ProposalStatus = decision.approved ? 'approved' : 'rejected';
    proposal.status = newStatus;
    proposal.decidedAt = new Date().toISOString();
    proposal.decidedBy = decision.actor;

    await this.repository.addAuditEvent(newAuditEvent({
      tenantAlias: proposal.tenantAlias,
      incidentId: proposal.incidentId,
      proposalId: proposal.proposalId,
      actor: decision.actor,
      action: decision.approved ? 'proposal.approved' : 'proposal.rejected',
      details: { reason: decision.reason },
    }));

    if (decision.approved) {
      try {
        const result = await this.executor.execute(proposal);
        proposal.status = 'executed';
        proposal.executionNote = result.note;
      } catch (err) {
        proposal.status = 'failed';
        proposal.executionNote = err instanceof Error ? err.message : 'Execution failed';
      }

      await this.repository.addAuditEvent(newAuditEvent({
        tenantAlias: proposal.tenantAlias,
        incidentId: proposal.incidentId,
        proposalId: proposal.proposalId,
        actor: 'system',
        action: proposal.status === 'executed' ? 'proposal.executed' : 'proposal.execution-failed',
        details: { note: proposal.executionNote },
      }));
    }

    await this.repository.saveProposal(proposal);
    return proposal;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newAuditEvent(input: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
  return {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
}
