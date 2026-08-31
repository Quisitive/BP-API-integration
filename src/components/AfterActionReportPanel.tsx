// ---------------------------------------------------------------------------
// After Action Report Panel — Incident Case Write-Up
// ---------------------------------------------------------------------------
// Lets a SOC analyst generate a draft Incident After Action Report by
// aggregating Blackpoint detections/alerts and Defender XDR incidents/alerts,
// edit every narrative section and the auto-suggested remediation plan
// (owner / timeline / priority), then export as Markdown or printable HTML/PDF.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import {
  listReports,
  generateReport,
  saveReport as apiSaveReport,
  finalizeReport,
  deleteReport as apiDeleteReport,
  reportExportUrl,
  xdrIncidents,
  bpDetections,
  type AfterActionReport,
  type RemediationAction,
  type RemediationPriority,
  type RemediationActionStatus,
  type IncidentSummary,
} from '../services/unifiedApi';
import './AfterActionReportPanel.css';

interface Props {
  tenantAlias: string;
  currentUser?: string;
}

interface BpDetectionOption {
  id: string;
  label: string;
}

const PRIORITIES: RemediationPriority[] = ['P1', 'P2', 'P3', 'P4'];
const ACTION_STATUSES: RemediationActionStatus[] = ['open', 'in-progress', 'completed', 'not-needed'];

function normalizeDetections(raw: unknown): BpDetectionOption[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown[] })?.items)
      ? (raw as { items: unknown[] }).items
      : [];
  return items
    .map((d) => {
      const rec = d as Record<string, unknown>;
      const id = String(rec.id ?? '');
      if (!id) return null;
      const label = String(rec.groupKey ?? rec.title ?? id);
      return { id, label };
    })
    .filter((x): x is BpDetectionOption => x !== null);
}

const AfterActionReportPanel: React.FC<Props> = ({ tenantAlias, currentUser = 'analyst' }) => {
  const [reports, setReports] = useState<AfterActionReport[]>([]);
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [detections, setDetections] = useState<BpDetectionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Generation form
  const [title, setTitle] = useState('');
  const [selectedXdr, setSelectedXdr] = useState<Record<string, boolean>>({});
  const [selectedBp, setSelectedBp] = useState<Record<string, boolean>>({});
  const [extraBpIds, setExtraBpIds] = useState('');
  const [generating, setGenerating] = useState(false);

  // Active report (editable draft)
  const [active, setActive] = useState<AfterActionReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, inc, det] = await Promise.all([
        listReports(tenantAlias),
        xdrIncidents(tenantAlias, 50).catch(() => [] as IncidentSummary[]),
        bpDetections(tenantAlias, { take: '50' }).catch(() => [] as unknown[]),
      ]);
      setReports(r);
      setIncidents(inc);
      setDetections(normalizeDetections(det));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    setActive(null);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantAlias]);

  const selectedXdrIds = useMemo(
    () => Object.entries(selectedXdr).filter(([, v]) => v).map(([k]) => k),
    [selectedXdr],
  );
  const selectedBpIds = useMemo(() => {
    const fromList = Object.entries(selectedBp).filter(([, v]) => v).map(([k]) => k);
    const manual = extraBpIds.split(',').map((s) => s.trim()).filter(Boolean);
    return [...new Set([...fromList, ...manual])];
  }, [selectedBp, extraBpIds]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedXdrIds.length === 0 && selectedBpIds.length === 0) {
      setError('Select at least one Defender XDR incident or Blackpoint detection.');
      return;
    }
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const report = await generateReport(tenantAlias, {
        title: title.trim() || undefined,
        authoredBy: currentUser,
        xdrIncidentIds: selectedXdrIds,
        bpDetectionIds: selectedBpIds,
      });
      setActive(report);
      setDirty(false);
      setNotice('Draft report generated. Review and edit the sections below.');
      setTitle('');
      setSelectedXdr({});
      setSelectedBp({});
      setExtraBpIds('');
      await refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const refreshList = async () => {
    try {
      setReports(await listReports(tenantAlias));
    } catch {
      // non-fatal
    }
  };

  const openReport = (report: AfterActionReport) => {
    setActive(report);
    setDirty(false);
    setNotice(null);
    setError(null);
  };

  const patchActive = (patch: Partial<AfterActionReport>) => {
    setActive((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };

  const patchAction = (id: string, patch: Partial<RemediationAction>) => {
    setActive((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        remediationActions: prev.remediationActions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      };
    });
    setDirty(true);
  };

  const addAction = () => {
    setActive((prev) => {
      if (!prev) return prev;
      const newAction: RemediationAction = {
        id: `manual-${Date.now()}`,
        title: 'New remediation step',
        description: '',
        owner: 'SOC Analyst',
        timeline: 'Within 24 hours',
        priority: 'P3',
        status: 'open',
        source: 'analyst',
      };
      return { ...prev, remediationActions: [...prev.remediationActions, newAction] };
    });
    setDirty(true);
  };

  const removeAction = (id: string) => {
    setActive((prev) =>
      prev ? { ...prev, remediationActions: prev.remediationActions.filter((a) => a.id !== id) } : prev,
    );
    setDirty(true);
  };

  const handleSave = async () => {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await apiSaveReport(tenantAlias, active);
      setActive(saved);
      setDirty(false);
      setNotice('Report saved.');
      await refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      if (dirty) await apiSaveReport(tenantAlias, active);
      const finalized = await finalizeReport(tenantAlias, active.id, currentUser);
      setActive(finalized);
      setDirty(false);
      setNotice('Report finalized.');
      await refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (reportId: string) => {
    setError(null);
    try {
      await apiDeleteReport(tenantAlias, reportId);
      if (active?.id === reportId) setActive(null);
      await refreshList();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handlePrint = () => {
    if (!active) return;
    window.open(reportExportUrl(tenantAlias, active.id, 'html'), '_blank', 'noopener');
  };

  return (
    <div className="aar-panel">
      <header className="aar-header">
        <h2>Incident After Action Report</h2>
        <p className="aar-subtitle">
          Aggregate Blackpoint and Defender XDR incident/alert data into a case write-up with
          analyst-editable remediation recommendations.
        </p>
      </header>

      {error && <div className="aar-banner aar-error">{error}</div>}
      {notice && <div className="aar-banner aar-notice">{notice}</div>}

      <div className="aar-layout">
        {/* -------- Left: generate + saved reports -------- */}
        <aside className="aar-sidebar">
          <form className="aar-generate" onSubmit={handleGenerate}>
            <h3>Generate new report</h3>
            <label className="aar-field">
              <span>Report title (optional)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto-derived from incident" />
            </label>

            <div className="aar-select-group">
              <span className="aar-select-label">Defender XDR incidents</span>
              <div className="aar-checklist">
                {incidents.length === 0 && <p className="aar-muted">No incidents loaded.</p>}
                {incidents.map((i) => (
                  <label key={i.id} className="aar-check">
                    <input
                      type="checkbox"
                      checked={!!selectedXdr[i.id]}
                      onChange={(e) => setSelectedXdr((p) => ({ ...p, [i.id]: e.target.checked }))}
                    />
                    <span className={`aar-sev sev-${i.severity}`}>{i.severity}</span>
                    <span className="aar-check-title">{i.title}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="aar-select-group">
              <span className="aar-select-label">Blackpoint detections</span>
              <div className="aar-checklist">
                {detections.length === 0 && <p className="aar-muted">No detections loaded.</p>}
                {detections.map((d) => (
                  <label key={d.id} className="aar-check">
                    <input
                      type="checkbox"
                      checked={!!selectedBp[d.id]}
                      onChange={(e) => setSelectedBp((p) => ({ ...p, [d.id]: e.target.checked }))}
                    />
                    <span className="aar-check-title">{d.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="aar-field">
              <span>Additional detection IDs (comma-separated)</span>
              <input value={extraBpIds} onChange={(e) => setExtraBpIds(e.target.value)} placeholder="id1, id2" />
            </label>

            <button type="submit" className="aar-btn aar-btn-primary" disabled={generating}>
              {generating ? 'Generating…' : 'Generate draft'}
            </button>
          </form>

          <div className="aar-saved">
            <h3>Saved reports</h3>
            {loading && <p className="aar-muted">Loading…</p>}
            {!loading && reports.length === 0 && <p className="aar-muted">No reports yet.</p>}
            <ul>
              {reports.map((r) => (
                <li key={r.id} className={active?.id === r.id ? 'active' : ''}>
                  <button className="aar-report-link" onClick={() => openReport(r)}>
                    <span className={`aar-status aar-status-${r.status}`}>{r.status}</span>
                    <span className="aar-report-title">{r.title}</span>
                    <span className="aar-muted aar-report-date">{new Date(r.updatedAt).toLocaleString()}</span>
                  </button>
                  <button className="aar-btn-icon" title="Delete report" onClick={() => handleDelete(r.id)}>×</button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* -------- Right: editor -------- */}
        <section className="aar-editor">
          {!active && <div className="aar-empty">Generate a new report or select a saved one to begin.</div>}

          {active && (
            <>
              <div className="aar-editor-toolbar">
                <div className="aar-editor-meta">
                  <span className={`aar-status aar-status-${active.status}`}>{active.status}</span>
                  <span className={`aar-sev sev-${active.severity}`}>{active.severity}</span>
                  {active.outstandingRisk && <span className="aar-risk-flag">Outstanding risk</span>}
                </div>
                <div className="aar-editor-actions">
                  <button className="aar-btn" onClick={handleSave} disabled={saving || !dirty}>
                    {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                  </button>
                  <button className="aar-btn" onClick={handleFinalize} disabled={saving || active.status === 'final'}>
                    Finalize
                  </button>
                  <a className="aar-btn" href={reportExportUrl(tenantAlias, active.id, 'markdown')}>
                    Export MD
                  </a>
                  <button className="aar-btn" onClick={handlePrint}>Print / PDF</button>
                </div>
              </div>

              <label className="aar-field">
                <span>Title</span>
                <input value={active.title} onChange={(e) => patchActive({ title: e.target.value })} />
              </label>

              <TextSection label="Executive Summary" value={active.executiveSummary} onChange={(v) => patchActive({ executiveSummary: v })} />
              <TextSection label="Detection Summary" value={active.detectionSummary} onChange={(v) => patchActive({ detectionSummary: v })} />

              <div className="aar-section">
                <h4>Aggregated Sources ({active.sources.length})</h4>
                <table className="aar-table">
                  <thead>
                    <tr><th>System</th><th>Type</th><th>Title</th><th>Severity</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {active.sources.map((s, idx) => (
                      <tr key={`${s.system}-${s.id}-${idx}`}>
                        <td>{s.system}</td><td>{s.kind}</td><td>{s.title || s.id}</td>
                        <td>{s.severity || '—'}</td><td>{s.status || '—'}</td>
                      </tr>
                    ))}
                    {active.sources.length === 0 && <tr><td colSpan={5} className="aar-muted">No sources.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="aar-section">
                <h4>Impacted Assets ({active.impactedAssets.length})</h4>
                {active.impactedAssets.length ? (
                  <ul className="aar-asset-list">{active.impactedAssets.map((a, i) => <li key={i}>{a}</li>)}</ul>
                ) : <p className="aar-muted">None recorded.</p>}
              </div>

              <div className="aar-section">
                <h4>Timeline ({active.timeline.length})</h4>
                <ul className="aar-timeline">
                  {active.timeline.map((t, i) => (
                    <li key={i}>
                      <span className="aar-ts">{t.timestamp}</span>
                      <span className={`aar-src aar-src-${t.source}`}>{t.source}</span>
                      <span>{t.label}{t.detail ? ` · ${t.detail}` : ''}</span>
                    </li>
                  ))}
                  {active.timeline.length === 0 && <li className="aar-muted">No timeline entries.</li>}
                </ul>
              </div>

              <TextSection label="Investigation Findings" value={active.investigationFindings} onChange={(v) => patchActive({ investigationFindings: v })} />
              <TextSection label="Containment Actions" value={active.containmentActions} onChange={(v) => patchActive({ containmentActions: v })} />
              <TextSection label="Root Cause" value={active.rootCause} onChange={(v) => patchActive({ rootCause: v })} />
              <TextSection label="Lessons Learned" value={active.lessonsLearned} onChange={(v) => patchActive({ lessonsLearned: v })} />

              <div className="aar-section">
                <div className="aar-section-head">
                  <h4>Recommended Next Steps (Remediation)</h4>
                  <label className="aar-inline-check">
                    <input
                      type="checkbox"
                      checked={active.outstandingRisk}
                      onChange={(e) => patchActive({ outstandingRisk: e.target.checked })}
                    />
                    Remediation still outstanding
                  </label>
                </div>
                <table className="aar-table aar-actions-table">
                  <thead>
                    <tr>
                      <th>Priority</th><th>Action</th><th>Owner (by who)</th><th>Timeline</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.remediationActions.map((a) => (
                      <tr key={a.id} className={`prio-${a.priority}`}>
                        <td>
                          <select value={a.priority} onChange={(e) => patchAction(a.id, { priority: e.target.value as RemediationPriority })}>
                            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="aar-cell-input" value={a.title} onChange={(e) => patchAction(a.id, { title: e.target.value })} />
                          <textarea
                            className="aar-cell-textarea"
                            value={a.description}
                            placeholder="Details…"
                            onChange={(e) => patchAction(a.id, { description: e.target.value })}
                          />
                        </td>
                        <td><input className="aar-cell-input" value={a.owner} onChange={(e) => patchAction(a.id, { owner: e.target.value })} /></td>
                        <td><input className="aar-cell-input" value={a.timeline} onChange={(e) => patchAction(a.id, { timeline: e.target.value })} /></td>
                        <td>
                          <select value={a.status} onChange={(e) => patchAction(a.id, { status: e.target.value as RemediationActionStatus })}>
                            {ACTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td><button className="aar-btn-icon" title="Remove" onClick={() => removeAction(a.id)}>×</button></td>
                      </tr>
                    ))}
                    {active.remediationActions.length === 0 && (
                      <tr><td colSpan={6} className="aar-muted">No remediation actions.</td></tr>
                    )}
                  </tbody>
                </table>
                <button className="aar-btn" onClick={addAction}>+ Add step</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

interface TextSectionProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const TextSection: React.FC<TextSectionProps> = ({ label, value, onChange }) => (
  <label className="aar-field aar-section">
    <span>{label}</span>
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
  </label>
);

export default AfterActionReportPanel;
