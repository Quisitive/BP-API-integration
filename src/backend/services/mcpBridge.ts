// ---------------------------------------------------------------------------
// MCP Bridge — Defender Response Automation
// ---------------------------------------------------------------------------
// Ported from SecOps-O365-Command-Dashboard/defenderResponseMcpExecutor.ts.
// Dispatches approved remediation proposals to the Defender Response MCP
// gateway via a signed webhook. Implements the RemediationExecutor interface
// consumed by RemediationService.
// ---------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import type { RemediationProposal } from '../types.js';
import type { RemediationExecutor } from './remediationService.js';

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

export interface McpDispatchPayload {
  proposalId: string;
  tenantAlias: string;
  incidentId: string;
  action: string;
  target: string;
  parameters: Record<string, unknown>;
  timestamp: string;
}

function buildDispatchPayload(proposal: RemediationProposal): McpDispatchPayload {
  if (!proposal.mcpOperation) {
    throw new Error('Cannot build dispatch payload without mcpOperation');
  }
  return {
    proposalId: proposal.proposalId,
    tenantAlias: proposal.tenantAlias,
    incidentId: proposal.incidentId,
    action: proposal.mcpOperation.action,
    target: proposal.mcpOperation.target,
    parameters: proposal.mcpOperation.parameters,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class McpBridgeExecutor implements RemediationExecutor {
  private readonly webhookUrl: string | undefined;
  private readonly webhookSecret: string | undefined;

  constructor() {
    this.webhookUrl = process.env.MCP_AUTOMATION_WEBHOOK_URL;
    this.webhookSecret = process.env.MCP_AUTOMATION_WEBHOOK_SECRET;
  }

  async execute(proposal: RemediationProposal): Promise<{ note: string }> {
    if (!proposal.mcpOperation) {
      return {
        note: 'No automation mapping exists for this recommendation. Follow the manual steps.',
      };
    }

    if (!this.webhookUrl) {
      return {
        note: `Prepared ${proposal.mcpOperation.action}. Set MCP_AUTOMATION_WEBHOOK_URL to dispatch this action to your Defender Response MCP gateway.`,
      };
    }

    const payload = buildDispatchPayload(proposal);
    const bodyString = JSON.stringify(payload);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.webhookSecret) {
      headers['X-SecOps-Signature'] = createHmac('sha256', this.webhookSecret)
        .update(bodyString)
        .digest('hex');
    }

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers,
      body: bodyString,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Failed to execute MCP automation: ${response.status} ${text}`,
      );
    }

    const suffix = this.webhookSecret ? ' with signed payload' : '';
    return {
      note: `Executed ${proposal.mcpOperation.action} through Defender Response MCP bridge${suffix}.`,
    };
  }
}
