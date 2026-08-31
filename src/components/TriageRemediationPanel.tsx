// ---------------------------------------------------------------------------
// Triage & Remediation Panel
// ---------------------------------------------------------------------------
// Lets SOC analysts trigger playbook recommendations for an incident,
// view proposals, and approve/reject remediation actions.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import {
  triageRecommend,
  xdrCreatePlan,
  xdrProposals,
  xdrDecideProposal,
} from '../services/unifiedApi';
import './TriageRemediationPanel.css';

interface Props {
  tenantAlias: string;
  incidentId?: string;
  incidentTitle?: string;
  incidentSeverity?: string;
  incidentWorkloads?: string[];
}

interface Proposal {
  proposalId: string;
  id: string;
  title: string;
  riskLevel: string;
  status: string;
  description: string;
}

const TriageRemediationPanel: React.FC<Props> = ({
  tenantAlias,
  incidentId,
  incidentTitle,
  incidentSeverity,
  incidentWorkloads,
}) => {
  const [recommendations, setRecommendations] = useState<unknown[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'recommended' | 'planned'>('idle');

  const handleRecommend = async () => {
    if (!incidentTitle || !incidentSeverity || !incidentWorkloads) return;
    setLoading(true);
    setError(null);
    try {
      const recs = await triageRecommend(tenantAlias, {
        title: incidentTitle,
        severity: incidentSeverity,
        workloads: incidentWorkloads,
      });
      setRecommendations(recs);
      setPhase('recommended');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePlan = async () => {
    if (!incidentId) return;
    setLoading(true);
    setError(null);
    try {
      await xdrCreatePlan(tenantAlias, incidentId);
      const p = (await xdrProposals(tenantAlias, incidentId)) as Proposal[];
      setProposals(p);
      setPhase('planned');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDecide = async (proposalId: string, approved: boolean) => {
    setLoading(true);
    try {
      await xdrDecideProposal(tenantAlias, proposalId, approved);
      // Refresh proposals
      const p = (await xdrProposals(tenantAlias, incidentId)) as Proposal[];
      setProposals(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="triage-remediation-panel">
      <h3>Triage & Remediation</h3>
      {error && <div className="trp-error">{error}</div>}

      {!incidentId && (
        <p className="trp-hint">Select an incident to begin triage.</p>
      )}

      {incidentId && phase === 'idle' && (
        <div className="trp-actions">
          <button onClick={handleRecommend} disabled={loading}>
            Get Playbook Recommendations
          </button>
        </div>
      )}

      {phase === 'recommended' && (
        <div className="trp-recommendations">
          <h4>Recommendations ({recommendations.length})</h4>
          <ul>
            {recommendations.map((r: any, i) => (
              <li key={i}>
                <strong>{r.title}</strong> — {r.description}
                <span className={`trp-risk trp-risk-${r.riskLevel}`}>{r.riskLevel}</span>
              </li>
            ))}
          </ul>
          <button onClick={handleCreatePlan} disabled={loading}>
            Create Remediation Plan
          </button>
        </div>
      )}

      {phase === 'planned' && (
        <div className="trp-proposals">
          <h4>Remediation Proposals</h4>
          <table className="trp-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Risk</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.proposalId}>
                  <td>{p.title}</td>
                  <td className={`trp-risk trp-risk-${p.riskLevel}`}>{p.riskLevel}</td>
                  <td>{p.status}</td>
                  <td>
                    {p.status === 'pending' && (
                      <>
                        <button
                          className="trp-approve"
                          onClick={() => handleDecide(p.proposalId, true)}
                          disabled={loading}
                        >
                          Approve
                        </button>
                        <button
                          className="trp-reject"
                          onClick={() => handleDecide(p.proposalId, false)}
                          disabled={loading}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {p.status !== 'pending' && <span>{p.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TriageRemediationPanel;
