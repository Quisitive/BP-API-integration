// ---------------------------------------------------------------------------
// Unified Command Dashboard — Main View
// ---------------------------------------------------------------------------
// Combines Blackpoint detection metrics and Defender XDR incident status into
// a single SOC overview pane. Acts as the landing page for the unified app.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import {
  bpAnalyticsCount,
  bpDetection,
  xdrIncidents,
  xdrIncident,
  xdrEvidence,
  unifiedAlerts,
  unifiedAudit,
  unifiedCorrelations,
  triageRecommend,
  createUnifiedAuditEvent,
  type IncidentSummary,
  type IncidentEvidenceLink,
  type BpDetectionDetail,
  type AlertSnapshot,
  type DetectionCorrelation,
  type AuditEvent,
  type TriageRecommendation,
} from '../services/unifiedApi';
import './UnifiedCommandDashboard.css';

interface Props {
  tenantAlias: string;
}

interface BpCounts {
  open: number;
  resolved: number;
}

interface IncidentContext {
  incident: IncidentSummary;
  evidenceLinks: IncidentEvidenceLink[];
  relatedCorrelations: DetectionCorrelation[];
  relatedDetections: BpDetectionDetail[];
  auditEvents: AuditEvent[];
  recommendedActions: TriageRecommendation[];
  baselineNextSteps: string[];
}

interface ChecklistItem {
  id: string;
  label: string;
  source: 'recommended' | 'baseline';
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

function buildBaselineNextSteps(incident: IncidentSummary, linkedDetectionCount: number): string[] {
  const steps: string[] = [];
  const workloads = incident.workloads || [];
  steps.push('Validate the scope by confirming impacted users, devices, mailboxes, and identities from incident evidence.');

  if (incident.status === 'Active' || incident.status === 'InProgress') {
    steps.push('Contain active risk first: isolate affected endpoints, disable compromised identities, and block known malicious indicators.');
  }

  if (workloads.includes('DefenderForOffice365')) {
    steps.push('Review malicious email traces and perform tenant-wide message remediation where needed.');
  }

  if (workloads.includes('DefenderForEndpoint')) {
    steps.push('Run endpoint hunting and verify sensor coverage on impacted hosts before closing the case.');
  }

  if (linkedDetectionCount > 0) {
    steps.push(`Cross-check ${linkedDetectionCount} linked Blackpoint detection(s) to confirm timeline alignment and avoid duplicate remediation work.`);
  }

  steps.push('Document owner, decision, and closure rationale in the audit trail before final remediation sign-off.');
  return steps;
}

const UnifiedCommandDashboard: React.FC<Props> = ({ tenantAlias }) => {
  const [bpCounts, setBpCounts] = useState<BpCounts>({ open: 0, resolved: 0 });
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [alerts, setAlerts] = useState<AlertSnapshot[]>([]);
  const [correlations, setCorrelations] = useState<DetectionCorrelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [loadingIncidentContext, setLoadingIncidentContext] = useState(false);
  const [incidentContext, setIncidentContext] = useState<IncidentContext | null>(null);
  const [checklistStatus, setChecklistStatus] = useState<Record<string, boolean>>({});
  const [savingChecklistItemId, setSavingChecklistItemId] = useState<string | null>(null);

  const buildChecklistItems = (context: IncidentContext): ChecklistItem[] => {
    const recommended = context.recommendedActions.map((rec) => ({
      id: `rec:${rec.id}`,
      label: rec.title,
      source: 'recommended' as const,
      riskLevel: rec.riskLevel,
    }));

    const baseline = context.baselineNextSteps.map((step, index) => ({
      id: `base:${index + 1}`,
      label: step,
      source: 'baseline' as const,
    }));

    return [...recommended, ...baseline];
  };

  const deriveChecklistStateFromAudit = (events: AuditEvent[]): Record<string, boolean> => {
    const state: Record<string, boolean> = {};
    const checklistEvents = events.filter((e) => e.action === 'incident-checklist-item');

    for (const ev of checklistEvents) {
      const itemId = typeof ev.details?.itemId === 'string' ? ev.details.itemId : undefined;
      const checked = typeof ev.details?.checked === 'boolean' ? ev.details.checked : undefined;
      if (itemId && checked !== undefined) {
        state[itemId] = checked;
      }
    }

    return state;
  };

  const handleChecklistToggle = async (item: ChecklistItem, checked: boolean) => {
    if (!incidentContext) return;

    setChecklistStatus((prev) => ({ ...prev, [item.id]: checked }));
    setSavingChecklistItemId(item.id);

    try {
      await createUnifiedAuditEvent(tenantAlias, {
        incidentId: incidentContext.incident.id,
        actor: 'soc-analyst@unified-console',
        action: 'incident-checklist-item',
        details: {
          itemId: item.id,
          itemLabel: item.label,
          itemSource: item.source,
          checked,
          riskLevel: item.riskLevel,
        },
      });

      setIncidentContext((prev) =>
        prev
          ? {
              ...prev,
              auditEvents: [
                {
                  id: crypto.randomUUID(),
                  tenantAlias,
                  incidentId: prev.incident.id,
                  actor: 'soc-analyst@unified-console',
                  action: 'incident-checklist-item',
                  details: {
                    itemId: item.id,
                    itemLabel: item.label,
                    itemSource: item.source,
                    checked,
                    riskLevel: item.riskLevel,
                  },
                  createdAt: new Date().toISOString(),
                },
                ...prev.auditEvents,
              ],
            }
          : prev,
      );
    } catch {
      setChecklistStatus((prev) => ({ ...prev, [item.id]: !checked }));
      setWarning('Failed to persist checklist update. Please retry.');
    } finally {
      setSavingChecklistItemId(null);
    }
  };

  const openIncidentInXdr = (context: IncidentContext) => {
    const openExternal = (url: string): boolean => {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      return opened !== null;
    };

    const preferred =
      context.evidenceLinks.find((l) => l.source === 'defender-portal') || context.evidenceLinks[0];

    if (preferred?.url) {
      if (!openExternal(preferred.url)) {
        setWarning('Popup blocked while opening Defender XDR. Allow pop-ups for this site and try again.');
      }
      return;
    }

    // Fallback if deep links are unavailable.
    if (!openExternal(`https://security.microsoft.com/incidents/${encodeURIComponent(context.incident.id)}`)) {
      setWarning('Popup blocked while opening Defender XDR. Allow pop-ups for this site and try again.');
    }
  };

  const selectIncident = async (incident: IncidentSummary) => {
    setSelectedIncidentId(incident.id);
    setLoadingIncidentContext(true);

    try {
      const relatedCorrelations = correlations.filter((c) => c.xdrIncidentId === incident.id);
      const uniqueDetectionIds = [...new Set(relatedCorrelations.map((c) => c.bpDetectionId))].slice(0, 15);

      const [incidentRes, evidenceRes, auditRes, detectionsRes] = await Promise.allSettled([
        xdrIncident(tenantAlias, incident.id),
        xdrEvidence(tenantAlias, incident.id),
        unifiedAudit(tenantAlias, incident.id),
        Promise.all(uniqueDetectionIds.map((id) => bpDetection(tenantAlias, id))),
      ]);

      const resolvedIncident = incidentRes.status === 'fulfilled' ? incidentRes.value : incident;
      const evidenceLinks = evidenceRes.status === 'fulfilled' ? evidenceRes.value : [];
      const auditEvents = auditRes.status === 'fulfilled' ? auditRes.value : [];
      const relatedDetections = detectionsRes.status === 'fulfilled' ? detectionsRes.value : [];

      const recommendationsRes = await Promise.allSettled([
        triageRecommend(tenantAlias, {
          title: resolvedIncident.title,
          severity: resolvedIncident.severity,
          workloads: resolvedIncident.workloads,
        }),
      ]);

      const recommendedActions =
        recommendationsRes[0].status === 'fulfilled' ? recommendationsRes[0].value : [];
      const baselineNextSteps = buildBaselineNextSteps(
        resolvedIncident,
        relatedDetections.length,
      );

      setIncidentContext({
        incident: resolvedIncident,
        evidenceLinks,
        relatedCorrelations,
        relatedDetections,
        auditEvents,
        recommendedActions,
        baselineNextSteps,
      });
      setChecklistStatus(deriveChecklistStateFromAudit(auditEvents));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Incident context load failed', err);
      setWarning(`Unable to load incident context. ${detail}`);
      setIncidentContext(null);
      setChecklistStatus({});
    } finally {
      setLoadingIncidentContext(false);
    }
  };

  useEffect(() => {
    if (!tenantAlias) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    setSelectedIncidentId(null);
    setChecklistStatus({});
    setIncidentContext(null);

    Promise.allSettled([
      bpAnalyticsCount(tenantAlias, 'OPEN'),
      bpAnalyticsCount(tenantAlias, 'RESOLVED'),
      xdrIncidents(tenantAlias, 20),
      unifiedAlerts(tenantAlias, 50),
      unifiedCorrelations(tenantAlias),
    ])
      .then((results) => {
        const [openRes, resolvedRes, incRes, alertRes, corRes] = results;
        const nonBlockingWarnings: string[] = [];

        if (openRes.status === 'fulfilled' && resolvedRes.status === 'fulfilled') {
          setBpCounts({ open: openRes.value.count, resolved: resolvedRes.value.count });
        } else {
          const reason =
            openRes.status === 'rejected'
              ? openRes.reason
              : resolvedRes.status === 'rejected'
                ? resolvedRes.reason
                : new Error('Failed to fetch BP analytics');

          const detail = reason instanceof Error ? reason.message : String(reason);
          setBpCounts({ open: 0, resolved: 0 });
          nonBlockingWarnings.push(`Blackpoint analytics unavailable (${detail}).`);
        }

        if (incRes.status === 'fulfilled') {
          setIncidents(incRes.value);
        } else {
          setIncidents([]);
          nonBlockingWarnings.push('Defender XDR data unavailable (tenant may not be onboarded for Microsoft yet).');
        }

        if (alertRes.status === 'fulfilled') {
          setAlerts(alertRes.value);
        } else {
          setAlerts([]);
          nonBlockingWarnings.push('Unified alert timeline unavailable.');
        }

        if (corRes.status === 'fulfilled') {
          setCorrelations(corRes.value);
        } else {
          setCorrelations([]);
          nonBlockingWarnings.push('Correlation data unavailable.');
        }

        setWarning(nonBlockingWarnings.length ? nonBlockingWarnings.join(' ') : null);
      })
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        setError(detail);
      })
      .finally(() => setLoading(false));
  }, [tenantAlias]);

  if (loading) return <div className="ucd-loading">Loading unified dashboard…</div>;
  if (error) return <div className="ucd-error">Error: {error}</div>;

  const activeXdr = incidents.filter((i) => i.status === 'Active' || i.status === 'InProgress');
  const criticalXdr = incidents.filter((i) => i.severity === 'High' || i.severity === 'Critical');

  return (
    <div className="unified-command-dashboard">
      <h2>Unified SOC Command — {tenantAlias}</h2>
      {warning && <div className="ucd-warning">{warning}</div>}

      {/* KPI Cards */}
      <div className="ucd-kpi-row">
        <div className="ucd-kpi-card bp-open">
          <span className="ucd-kpi-value">{bpCounts.open}</span>
          <span className="ucd-kpi-label">BP Open Detections</span>
        </div>
        <div className="ucd-kpi-card bp-resolved">
          <span className="ucd-kpi-value">{bpCounts.resolved}</span>
          <span className="ucd-kpi-label">BP Resolved</span>
        </div>
        <div className="ucd-kpi-card xdr-active">
          <span className="ucd-kpi-value">{activeXdr.length}</span>
          <span className="ucd-kpi-label">XDR Active Incidents</span>
        </div>
        <div className="ucd-kpi-card xdr-critical">
          <span className="ucd-kpi-value">{criticalXdr.length}</span>
          <span className="ucd-kpi-label">High/Critical XDR</span>
        </div>
        <div className="ucd-kpi-card correlations">
          <span className="ucd-kpi-value">{correlations.length}</span>
          <span className="ucd-kpi-label">Correlations</span>
        </div>
      </div>

      {/* Recent Unified Alert Timeline */}
      <section className="ucd-section">
        <h3>Recent Alert Timeline (Cross-Source)</h3>
        {alerts.length === 0 ? (
          <p className="ucd-empty">No alert snapshots recorded yet.</p>
        ) : (
          <table className="ucd-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Title</th>
                <th>Severity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {alerts.slice(0, 20).map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.createdAt).toLocaleString()}</td>
                  <td className={`ucd-source ucd-source-${a.source}`}>{a.source}</td>
                  <td>{a.title}</td>
                  <td>{a.severity}</td>
                  <td>{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* XDR Incidents Table */}
      <section className="ucd-section">
        <h3>Defender XDR Incidents (click row to load full case context)</h3>
        <table className="ucd-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Assigned</th>
              <th>Alerts</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((inc) => (
              <tr
                key={inc.id}
                className={`ucd-sev-${inc.severity.toLowerCase()} ucd-row-clickable`}
                role="button"
                tabIndex={0}
                aria-label={`Load context for incident ${inc.id}`}
                onClick={() => {
                  void selectIncident(inc);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void selectIncident(inc);
                  }
                }}
              >
                <td>{inc.id}</td>
                <td>{inc.title}</td>
                <td>{inc.severity}</td>
                <td>{inc.status}</td>
                <td>{inc.assignedTo || '—'}</td>
                <td>{inc.alertsCount}</td>
                <td>{new Date(inc.createdTime).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="ucd-section ucd-case-panel">
        <h3>Incident 360 Context</h3>
        {!selectedIncidentId && <p className="ucd-empty">Select an incident above to load all available XDR + Blackpoint context.</p>}
        {selectedIncidentId && loadingIncidentContext && <p className="ucd-empty">Loading incident context...</p>}
        {selectedIncidentId && !loadingIncidentContext && incidentContext && (
          <div className="ucd-case-grid">
            <div className="ucd-case-card">
              <h4>Incident Summary</h4>
              <p><strong>ID:</strong> {incidentContext.incident.id}</p>
              <p><strong>Title:</strong> {incidentContext.incident.title}</p>
              <p><strong>Severity:</strong> {incidentContext.incident.severity}</p>
              <p><strong>Status:</strong> {incidentContext.incident.status}</p>
              <p><strong>Assigned:</strong> {incidentContext.incident.assignedTo || '—'}</p>
              <p><strong>Classification:</strong> {incidentContext.incident.classification || '—'}</p>
              <p><strong>Determination:</strong> {incidentContext.incident.determination || '—'}</p>
              <p><strong>Workloads:</strong> {incidentContext.incident.workloads.join(', ') || '—'}</p>
              <p><strong>Created:</strong> {new Date(incidentContext.incident.createdTime).toLocaleString()}</p>
              <button
                type="button"
                className="ucd-open-btn"
                onClick={() => openIncidentInXdr(incidentContext)}
              >
                Open in Defender Portal
              </button>
            </div>

            <div className="ucd-case-card">
              <h4>Linked Blackpoint Detections</h4>
              {incidentContext.relatedDetections.length === 0 ? (
                <p className="ucd-empty">No linked Blackpoint detections found.</p>
              ) : (
                <table className="ucd-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Title</th>
                      <th>Severity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidentContext.relatedDetections.map((det) => (
                      <tr key={det.id}>
                        <td>{det.id}</td>
                        <td>{det.title || det.groupKey || '—'}</td>
                        <td>{det.severity || '—'}</td>
                        <td>{det.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="ucd-meta">Correlations: {incidentContext.relatedCorrelations.length}</p>
            </div>

            <div className="ucd-case-card">
              <h4>XDR Evidence Links</h4>
              {incidentContext.evidenceLinks.length === 0 ? (
                <p className="ucd-empty">No evidence links were returned by API.</p>
              ) : (
                <ul className="ucd-links-list">
                  {incidentContext.evidenceLinks.map((link) => (
                    <li key={`${link.source}-${link.url}`}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
                      <span className="ucd-link-source">{link.source}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ucd-case-card">
              <h4>Audit Trail for This Incident</h4>
              {incidentContext.auditEvents.length === 0 ? (
                <p className="ucd-empty">No local analyst actions recorded yet.</p>
              ) : (
                <ul className="ucd-audit-list">
                  {incidentContext.auditEvents.slice(0, 15).map((event) => (
                    <li key={event.id}>
                      <span className="ucd-audit-time">{new Date(event.createdAt).toLocaleString()}</span>
                      <span className="ucd-audit-main">{event.actor} — {event.action}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ucd-case-card">
              <h4>Recommended Actions</h4>
              {incidentContext.recommendedActions.length === 0 ? (
                <p className="ucd-empty">No playbook-specific recommendations returned. Use baseline next steps below.</p>
              ) : (
                <ul className="ucd-audit-list">
                  {incidentContext.recommendedActions.map((rec) => (
                    <li key={rec.id}>
                      <span className={`ucd-risk-pill ucd-risk-${rec.riskLevel}`}>{rec.riskLevel}</span>
                      <span className="ucd-audit-main"><strong>{rec.title}</strong>: {rec.description}</span>
                      {rec.manualSteps?.length ? (
                        <ul className="ucd-substeps-list">
                          {rec.manualSteps.slice(0, 4).map((step) => (
                            <li key={`${rec.id}-${step}`}>{step}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              <h4 className="ucd-inline-title">Baseline Next Steps</h4>
              <ul className="ucd-audit-list">
                {incidentContext.baselineNextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>

            <div className="ucd-case-card">
              <h4>Action Checklist</h4>
              {(() => {
                const checklistItems = buildChecklistItems(incidentContext);
                if (checklistItems.length === 0) {
                  return <p className="ucd-empty">No checklist actions available for this incident.</p>;
                }

                return (
                  <ul className="ucd-checklist">
                    {checklistItems.map((item) => {
                      const checked = !!checklistStatus[item.id];
                      return (
                        <li key={item.id} className="ucd-checklist-item">
                          <label>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={savingChecklistItemId === item.id}
                              onChange={(e) => {
                                void handleChecklistToggle(item, e.target.checked);
                              }}
                            />
                            <span className="ucd-checklist-label">
                              {item.riskLevel ? (
                                <span className={`ucd-risk-pill ucd-risk-${item.riskLevel}`}>{item.riskLevel}</span>
                              ) : null}
                              {item.label}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default UnifiedCommandDashboard;
