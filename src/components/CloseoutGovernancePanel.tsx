// ---------------------------------------------------------------------------
// Closeout Governance Panel
// ---------------------------------------------------------------------------
// Lists prior closeout records and provides a form for formally closing a
// case with resolution notes and governance metadata.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import {
  unifiedCloseouts,
  createCloseout,
  unifiedAudit,
  type CloseoutRecord,
  type AuditEvent,
} from '../services/unifiedApi';
import './CloseoutGovernancePanel.css';

interface Props {
  tenantAlias: string;
  /** Pre-fill form with this BP detection ID */
  bpDetectionId?: string;
  /** Pre-fill form with this XDR incident ID */
  xdrIncidentId?: string;
  /** Current operator name (from auth context) */
  currentUser?: string;
}

const CloseoutGovernancePanel: React.FC<Props> = ({
  tenantAlias,
  bpDetectionId: prefillBp,
  xdrIncidentId: prefillXdr,
  currentUser = 'analyst',
}) => {
  const [closeouts, setCloseouts] = useState<CloseoutRecord[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'closeouts' | 'audit'>('closeouts');

  // Form
  const [bpId, setBpId] = useState(prefillBp || '');
  const [xdrId, setXdrId] = useState(prefillXdr || '');
  const [resolution, setResolution] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [c, a] = await Promise.all([
        unifiedCloseouts(tenantAlias),
        unifiedAudit(tenantAlias),
      ]);
      setCloseouts(c);
      setAudit(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [tenantAlias]);

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolution || (!bpId && !xdrId)) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCloseout(tenantAlias, {
        bpDetectionId: bpId || undefined,
        xdrIncidentId: xdrId || undefined,
        resolution,
        notes: notes || undefined,
        closedBy: currentUser,
      });
      setResolution('');
      setNotes('');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="cgp-loading">Loading governance data…</div>;

  return (
    <div className="closeout-governance-panel">
      <h3>Closeout Governance</h3>
      {error && <div className="cgp-error">{error}</div>}

      {/* Close case form */}
      <form className="cgp-form" onSubmit={handleClose}>
        <div className="cgp-form-row">
          <input placeholder="BP Detection ID" value={bpId} onChange={(e) => setBpId(e.target.value)} />
          <input placeholder="XDR Incident ID" value={xdrId} onChange={(e) => setXdrId(e.target.value)} />
        </div>
        <select value={resolution} onChange={(e) => setResolution(e.target.value)} required>
          <option value="">— Select Resolution —</option>
          <option value="true-positive-remediated">True Positive — Remediated</option>
          <option value="true-positive-no-action">True Positive — No Action Needed</option>
          <option value="false-positive">False Positive</option>
          <option value="benign-positive">Benign Positive</option>
          <option value="duplicate">Duplicate</option>
          <option value="informational">Informational Only</option>
        </select>
        <textarea
          placeholder="Analyst notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <button type="submit" disabled={submitting || (!bpId && !xdrId) || !resolution}>
          {submitting ? 'Closing…' : 'Close Case'}
        </button>
      </form>

      {/* Tabs */}
      <div className="cgp-tabs">
        <button className={tab === 'closeouts' ? 'active' : ''} onClick={() => setTab('closeouts')}>
          Closeouts ({closeouts.length})
        </button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
          Audit Trail ({audit.length})
        </button>
      </div>

      {tab === 'closeouts' && (
        <table className="cgp-table">
          <thead>
            <tr>
              <th>Closed At</th>
              <th>By</th>
              <th>Resolution</th>
              <th>BP ID</th>
              <th>XDR ID</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {closeouts.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.closedAt).toLocaleString()}</td>
                <td>{c.closedBy}</td>
                <td>{c.resolution}</td>
                <td className="cgp-mono">{c.bpDetectionId || '—'}</td>
                <td className="cgp-mono">{c.xdrIncidentId || '—'}</td>
                <td>{c.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'audit' && (
        <table className="cgp-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Incident</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
                <td>{a.actor}</td>
                <td>{a.action}</td>
                <td className="cgp-mono">{a.incidentId}</td>
                <td className="cgp-details">{JSON.stringify(a.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default CloseoutGovernancePanel;
