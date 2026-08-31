// ---------------------------------------------------------------------------
// Correlation Panel — Cross-Source Link Management
// ---------------------------------------------------------------------------
// Displays existing BP↔XDR correlations and allows analysts to create new
// manual (analyst-confirmed) correlations between detection sources.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import {
  unifiedCorrelations,
  createCorrelation,
  type DetectionCorrelation,
} from '../services/unifiedApi';
import './CorrelationPanel.css';

interface Props {
  tenantAlias: string;
}

const CorrelationPanel: React.FC<Props> = ({ tenantAlias }) => {
  const [correlations, setCorrelations] = useState<DetectionCorrelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [bpId, setBpId] = useState('');
  const [xdrId, setXdrId] = useState('');
  const [type, setType] = useState<string>('analyst-confirmed');
  const [confidence, setConfidence] = useState(0.9);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    unifiedCorrelations(tenantAlias)
      .then(setCorrelations)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tenantAlias]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bpId || !xdrId) return;
    setSubmitting(true);
    try {
      await createCorrelation(tenantAlias, bpId, xdrId, type, confidence);
      setBpId('');
      setXdrId('');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="cp-loading">Loading correlations…</div>;

  return (
    <div className="correlation-panel">
      <h3>Cross-Source Correlations</h3>
      {error && <div className="cp-error">{error}</div>}

      {/* Create form */}
      <form className="cp-form" onSubmit={handleCreate}>
        <input
          placeholder="BP Detection ID"
          value={bpId}
          onChange={(e) => setBpId(e.target.value)}
          required
        />
        <input
          placeholder="XDR Incident ID"
          value={xdrId}
          onChange={(e) => setXdrId(e.target.value)}
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="analyst-confirmed">Analyst Confirmed</option>
          <option value="entity">Entity Match</option>
          <option value="temporal">Temporal</option>
          <option value="title">Title Match</option>
        </select>
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value))}
          title="Confidence (0-1)"
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Linking…' : 'Link'}
        </button>
      </form>

      {/* Table */}
      {correlations.length === 0 ? (
        <p className="cp-empty">No correlations recorded for this tenant.</p>
      ) : (
        <table className="cp-table">
          <thead>
            <tr>
              <th>BP Detection</th>
              <th>XDR Incident</th>
              <th>Type</th>
              <th>Confidence</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {correlations.map((c) => (
              <tr key={c.id}>
                <td className="cp-mono">{c.bpDetectionId}</td>
                <td className="cp-mono">{c.xdrIncidentId}</td>
                <td>{c.correlationType}</td>
                <td>{(c.confidence * 100).toFixed(0)}%</td>
                <td>{new Date(c.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default CorrelationPanel;
