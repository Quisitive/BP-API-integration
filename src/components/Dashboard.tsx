import React, { useState, useEffect, useRef } from 'react';
import './Dashboard.css';
import ClosedDetectionsViewer from './ClosedDetectionsViewer';
import DetectionReportingDashboard from './DetectionReportingDashboard';
import TenantXdrOwnershipPanel from './TenantXdrOwnershipPanel';
import UnifiedSecurityPanel from './UnifiedSecurityPanel';
import {
  BlackpointReportRun,
  getReportJsonForTenant,
  getReportUrlForTenant,
  listReportsForTenant,
} from '../services/blackpointReports.service';

// ---------------------------------------------------------------------------
// Types — matching CompassOne API v1.7.0 spec
// ---------------------------------------------------------------------------

interface Tenant {
  id: string;
  name: string;
  domain: string | null;
  created: string;
  status: string;
  enableDeliveryEmail: boolean;
  description: string | null;
  accountId: string | null;
  industryType: string;
  informationalAlertsEmails: string[];
  mdrReportsEmails: string[];
  darkWebAlertsEmails: string[];
}

interface AlertGroup {
  id: string;
  customerId: string;
  groupKey: string;
  riskScore: number;
  alertCount: number;
  alertTypes: string[];
  status: 'OPEN' | 'RESOLVED';
  ticketId: string;
  created: string;
  updated?: string | null;
  ticket?: Record<string, unknown> | null;
  alert?: Record<string, unknown> | null;
}

interface AlertGroupsResponse {
  items: AlertGroup[];
  total: number;
  start: number;
  end: number;
}

interface RecentClosedDetection {
  id: string;
  tenantId: string;
  groupKey: string;
  status: 'RESOLVED';
  alertCount: number;
  riskScore: number;
  alertTypes: string[];
  createdDate: string;
  resolvedDate?: string;
  daysOpen?: number;
  ticketId?: string;
}

interface TenantDetectionReportData {
  tenantName: string;
  stats: {
    totalDetections: number;
    openDetections: number;
    resolvedDetections: number;
    averageRiskScore: number;
    maxRiskScore: number;
    minRiskScore: number;
  };
  topAlertTypes: Array<{ type: string; count: number }>;
  riskScoreDistribution: Array<{ range: string; count: number }>;
  recentClosed: RecentClosedDetection[];
  reportGeneratedAt: string;
  nativeReports: BlackpointReportRun[];
  latestNativeReportsByType: Record<string, BlackpointReportRun>;
  nativeReportsError?: string;
}

// ---------------------------------------------------------------------------
// API helpers  (proxy in src/setupProxy.js routes /v1/* → blackpointcyber.com)
// ---------------------------------------------------------------------------

function apiHeaders(tenantId?: string): HeadersInit {
  const h: Record<string, string> = {};
  if (tenantId) h['x-tenant-id'] = tenantId;
  return h;
}

async function apiFetch<T>(path: string, tenantId?: string): Promise<T> {
  const res = await fetch(path, { headers: apiHeaders(tenantId) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json() as Promise<T>;
}

async function loadTenants(): Promise<Tenant[]> {
  const data = await apiFetch<{ data: Tenant[]; meta: unknown }>('/v1/tenants?pageSize=50');
  return data.data;
}

async function loadAlertGroupPreview(tenantId: string): Promise<AlertGroupsResponse> {
  const qs = new URLSearchParams({
    take: '10',
    sortByColumn: 'created',
    sortDirection: 'DESC',
  });
  // Send OPEN status twice — repeated query param for array
  return apiFetch<AlertGroupsResponse>(`/v1/alert-groups?${qs}&status=OPEN`, tenantId);
}

async function loadAllAlertGroups(tenantId: string): Promise<AlertGroup[]> {
  const all: AlertGroup[] = [];
  let skip = 0;
  const take = 100;
  while (true) {
    const qs = new URLSearchParams({ take: String(take), skip: String(skip), sortByColumn: 'created', sortDirection: 'DESC' });
    const data = await apiFetch<AlertGroupsResponse>(`/v1/alert-groups?${qs}`, tenantId);
    all.push(...data.items);
    if (all.length >= data.total || data.items.length < take) break;
    skip += take;
  }
  return all;
}

async function loadAssetCount(tenantId: string, cls: 'DEVICE' | 'USER'): Promise<number> {
  try {
    const data = await apiFetch<{ meta: { totalItems: number } }>(
      `/v1/assets?class[]=${cls}&pageSize=1`,
      tenantId
    );
    return data.meta?.totalItems ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function riskToSeverity(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function getAlertAge(iso: string): { hours: number; text: string; ageCategory: string } {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const text = days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h` : `${mins}m`;
  const ageCategory = hours >= 72 ? 'overdue' : hours >= 24 ? 'delayed' : hours >= 4 ? 'warning' : 'good';
  return { hours, text, ageCategory };
}

function priorityScore(openGroups: AlertGroup[]): number {
  return openGroups.reduce((sum, ag) => {
    const { hours } = getAlertAge(ag.created);
    const sev = riskToSeverity(ag.riskScore);
    const m = sev === 'critical' ? 4 : sev === 'high' ? 3 : sev === 'medium' ? 2 : 1;
    return sum + (hours + 1) * m;
  }, 0);
}

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Tenant Detail Page
// ---------------------------------------------------------------------------

interface TenantDetailProps {
  tenant: Tenant;
  onBack: () => void;
}

const TenantDetailPage: React.FC<TenantDetailProps> = ({ tenant, onBack }) => {
  const [groups, setGroups] = useState<AlertGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'open' | 'closed' | 'native-reports' | 'detection-report' | 'xdr' | 'security'>('open');
  const [reportDropdownOpen, setReportDropdownOpen] = useState(false);
  const [closedDetections, setClosedDetections] = useState<AlertGroup[]>([]);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedError, setClosedError] = useState<string | null>(null);
  const [reportData, setReportData] = useState<TenantDetectionReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [nativeReportActionLoadingId, setNativeReportActionLoadingId] = useState<string | null>(null);
  const [nativeReportActionError, setNativeReportActionError] = useState<string | null>(null);
  const [selectedNativeReportId, setSelectedNativeReportId] = useState<string | null>(null);
  const [selectedNativeReportJson, setSelectedNativeReportJson] = useState<Record<string, unknown> | null>(null);
  const [nativeReportJsonLoading, setNativeReportJsonLoading] = useState(false);
  const [nativeReportJsonError, setNativeReportJsonError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    loadAllAlertGroups(tenant.id)
      .then(setGroups)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenant.id]);

  // Fetch closed detections when 'closed' tab is opened
  useEffect(() => {
    if (activeTab !== 'closed' || closedDetections.length > 0) return;
    let active = true;
    setClosedLoading(true);
    (async () => {
      try {
        const all: AlertGroup[] = [];
        const take = 100;
        for (let skip = 0; ; skip += take) {
          const qs = new URLSearchParams({
            take: String(take),
            skip: String(skip),
            status: 'RESOLVED',
            sortByColumn: 'created',
            sortDirection: 'DESC'
          });
          const data = await apiFetch<AlertGroupsResponse>(`/v1/alert-groups?${qs}`, tenant.id);
          all.push(...data.items);
          if (data.items.length < take) break;
        }
        if (active) setClosedDetections(all);
      } catch (err) {
        if (active) setClosedError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (active) setClosedLoading(false);
      }
    })();
    return () => { active = false; };
  }, [activeTab, tenant.id, closedDetections.length]);

  // Generate report data when either report tab is opened
  useEffect(() => {
    if ((activeTab !== 'native-reports' && activeTab !== 'detection-report') || reportData) return;
    let active = true;
    setReportLoading(true);
    setReportError(null);
    (async () => {
      try {
        const all: AlertGroup[] = [];
        const take = 100;
        for (let skip = 0; ; skip += take) {
          const qs = new URLSearchParams({
            take: String(take),
            skip: String(skip),
            sortByColumn: 'created',
            sortDirection: 'DESC'
          });
          const data = await apiFetch<AlertGroupsResponse>(`/v1/alert-groups?${qs}`, tenant.id);
          all.push(...data.items);
          if (data.items.length < take) break;
        }

        const openGroups = all.filter((g) => g.status === 'OPEN');
        const resolvedGroups = all.filter((g) => g.status === 'RESOLVED');
        const riskScores = all.map((g) => g.riskScore);

        // Calculate risk distribution
        const distribution = [
          { range: '0-20', count: all.filter((g) => g.riskScore >= 0 && g.riskScore <= 20).length },
          { range: '21-40', count: all.filter((g) => g.riskScore >= 21 && g.riskScore <= 40).length },
          { range: '41-60', count: all.filter((g) => g.riskScore >= 41 && g.riskScore <= 60).length },
          { range: '61-80', count: all.filter((g) => g.riskScore >= 61 && g.riskScore <= 80).length },
          { range: '81-100', count: all.filter((g) => g.riskScore >= 81 && g.riskScore <= 100).length }
        ];

        // Calculate top alert types
        const typeCounts: Record<string, number> = {};
        all.forEach((g) => {
          g.alertTypes.forEach((t) => {
            typeCounts[t] = (typeCounts[t] || 0) + 1;
          });
        });
        const topAlertTypes = Object.entries(typeCounts)
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        const recentClosed: RecentClosedDetection[] = resolvedGroups
          .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
          .slice(0, 20)
          .map((group) => ({
            id: group.id,
            tenantId: group.customerId,
            groupKey: group.groupKey,
            status: 'RESOLVED',
            alertCount: group.alertCount,
            riskScore: group.riskScore,
            alertTypes: group.alertTypes,
            createdDate: group.created,
            resolvedDate: group.updated || undefined,
            daysOpen: group.updated
              ? Math.ceil(
                  (new Date(group.updated).getTime() - new Date(group.created).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              : undefined,
            ticketId: group.ticketId,
          }));

        let nativeReports: BlackpointReportRun[] = [];
        let latestNativeReportsByType: Record<string, BlackpointReportRun> = {};
        let nativeReportsError: string | undefined;

        try {
          const reportResponse = await listReportsForTenant(tenant.id, {
            page: 1,
            pageSize: 50,
            sortBy: 'intervalStart',
            sortOrder: 'desc',
          });

          nativeReports = reportResponse.data ?? [];
          latestNativeReportsByType = nativeReports.reduce<Record<string, BlackpointReportRun>>(
            (acc, run) => {
              if (!acc[run.reportType]) {
                acc[run.reportType] = run;
              }
              return acc;
            },
            {}
          );
        } catch (nativeErr) {
          nativeReportsError = nativeErr instanceof Error ? nativeErr.message : 'Unable to load native reports';
        }

        if (active) {
          setReportData({
            tenantName: tenant.name,
            stats: {
              totalDetections: all.length,
              openDetections: openGroups.length,
              resolvedDetections: resolvedGroups.length,
              averageRiskScore:
                riskScores.length > 0
                  ? riskScores.reduce((a, b) => a + b, 0) / riskScores.length
                  : 0,
              maxRiskScore: riskScores.length > 0 ? Math.max(...riskScores) : 0,
              minRiskScore: riskScores.length > 0 ? Math.min(...riskScores) : 0,
            },
            topAlertTypes,
            riskScoreDistribution: distribution,
            recentClosed,
            reportGeneratedAt: new Date().toISOString(),
            nativeReports,
            latestNativeReportsByType,
            nativeReportsError,
          });
        }
      } catch (err) {
        if (active) setReportError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (active) setReportLoading(false);
      }
    })();
    return () => { active = false; };
  }, [activeTab, tenant.id, reportData]);

  const handleOpenNativeReportPdf = async (reportId: string) => {
    setNativeReportActionError(null);
    setNativeReportActionLoadingId(reportId);
    try {
      const response = await getReportUrlForTenant(tenant.id, reportId);
      const url = response.data?.url;
      if (!url) {
        throw new Error('Native report URL was empty');
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setNativeReportActionError(err instanceof Error ? err.message : 'Failed to open report PDF');
    } finally {
      setNativeReportActionLoadingId(null);
    }
  };

  const handleViewNativeReportJson = async (reportId: string) => {
    if (selectedNativeReportId === reportId && selectedNativeReportJson) {
      setSelectedNativeReportId(null);
      setSelectedNativeReportJson(null);
      setNativeReportJsonError(null);
      return;
    }

    setNativeReportJsonLoading(true);
    setNativeReportJsonError(null);
    setSelectedNativeReportId(reportId);

    try {
      const response = await getReportJsonForTenant(tenant.id, reportId);
      setSelectedNativeReportJson(response.data.report);
    } catch (err) {
      setSelectedNativeReportJson(null);
      setNativeReportJsonError(err instanceof Error ? err.message : 'Failed to load report JSON');
    } finally {
      setNativeReportJsonLoading(false);
    }
  };

  const openGroups = groups.filter(g => g.status === 'OPEN');
  const resolvedGroups = groups.filter(g => g.status === 'RESOLVED');
  const criticalGroups = groups.filter(g => riskToSeverity(g.riskScore) === 'critical');

  return (
    <div className="detail-container">
      <div className="detail-content">
        <button onClick={onBack} className="btn-primary btn-back">
          ← Back to Dashboard
        </button>

        {/* Tenant Header */}
        <div className="detail-header-card">
          <div className="card-header">
            <div className="tenant-avatar large">{tenant.name.substring(0, 2)}</div>
            <div>
              <h1 className="detail-title">{tenant.name}</h1>
              {tenant.domain && <p className="detail-subtitle">{tenant.domain}</p>}
              <div className="meta-grid">
                <div className="meta-item">
                  <span className="meta-label">Tenant ID</span>
                  <div className="meta-value mono">{tenant.id}</div>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Status</span>
                  <div className="meta-value green">{tenant.status}</div>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Created</span>
                  <div className="meta-value">{fmtDate(tenant.created)}</div>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Email Delivery</span>
                  <div className={`meta-value ${tenant.enableDeliveryEmail ? 'green' : 'red'}`}>
                    {tenant.enableDeliveryEmail ? '✓ Enabled' : '✗ Disabled'}
                  </div>
                </div>
                {tenant.industryType && (
                  <div className="meta-item">
                    <span className="meta-label">Industry</span>
                    <div className="meta-value">{tenant.industryType}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="metrics-grid">
            <div className="metric-item">
              <div className="metric-value blue">{groups.length}</div>
              <div className="metric-label">Total Groups</div>
            </div>
            <div className="metric-item">
              <div className="metric-value red">{openGroups.length}</div>
              <div className="metric-label">Open</div>
            </div>
            <div className="metric-item">
              <div className="metric-value critical">{criticalGroups.length}</div>
              <div className="metric-label">Critical Risk</div>
            </div>
            <div className="metric-item">
              <div className="metric-value green">{resolvedGroups.length}</div>
              <div className="metric-label">Resolved</div>
            </div>
          </div>
        </div>

        {/* Alert Groups */}
        {loading && <div className="loading-state">Loading alert groups…</div>}
        {error && <div className="error-message">⚠ {error}</div>}

        {!loading && !error && (
          <div>
            {/* Tab Navigation */}
            <div className="tab-navigation">
              <button
                className={`tab-button ${activeTab === 'open' ? 'active' : ''}`}
                onClick={() => setActiveTab('open')}
              >
                📋 Open Detections ({groups.filter(g => g.status === 'OPEN').length})
              </button>
              <button
                className={`tab-button ${activeTab === 'closed' ? 'active' : ''}`}
                onClick={() => setActiveTab('closed')}
              >
                ✓ Closed Detections ({groups.filter(g => g.status === 'RESOLVED').length})
              </button>
              <div className="tab-dropdown-wrapper">
                <button
                  className={`tab-button ${activeTab === 'native-reports' || activeTab === 'detection-report' ? 'active' : ''}`}
                  onClick={() => setReportDropdownOpen(!reportDropdownOpen)}
                >
                  📊 Reports ▾
                </button>
                {reportDropdownOpen && (
                  <div className="tab-dropdown-menu">
                    <button
                      className={`tab-dropdown-item ${activeTab === 'native-reports' ? 'active' : ''}`}
                      onClick={() => { setActiveTab('native-reports'); setReportDropdownOpen(false); }}
                    >
                      📄 Native Blackpoint Reports
                    </button>
                    <button
                      className={`tab-dropdown-item ${activeTab === 'detection-report' ? 'active' : ''}`}
                      onClick={() => { setActiveTab('detection-report'); setReportDropdownOpen(false); }}
                    >
                      📊 Detection Report
                    </button>
                  </div>
                )}
              </div>
              <button
                className={`tab-button ${activeTab === 'xdr' ? 'active' : ''}`}
                onClick={() => setActiveTab('xdr')}
              >
                🧭 XDR Ownership
              </button>
              <button
                className={`tab-button ${activeTab === 'security' ? 'active' : ''}`}
                onClick={() => setActiveTab('security')}
              >
                🔐 Security Feed
              </button>
            </div>

            {/* Open Detections Tab */}
            {activeTab === 'open' && (
              <div>
                <h2 className="section-title large">Detection Groups ({groups.length})</h2>
                {groups.length === 0 ? (
                  <div className="empty-state">No detection groups for this tenant</div>
                ) : (
                  <div className="alerts-list">
                {groups.map(group => {
                  const severity = riskToSeverity(group.riskScore);
                  const age = getAlertAge(group.created);
                  const isOpen = group.status === 'OPEN';

                  return (
                    <div
                      key={group.id}
                      onClick={() => setExpanded(expanded === group.id ? null : group.id)}
                      className="alert-card"
                      data-severity={severity}
                    >
                      <div className="alert-card-header">
                        <div className="alert-card-content">
                          <div
                            className="alert-title-row"
                            data-severity={severity}
                            data-status={isOpen ? 'open' : 'resolved'}
                          >
                            <div className="severity-dot"></div>
                            <span className="alert-title">
                              {group.alertTypes.length > 0
                                ? group.alertTypes.join(', ')
                                : group.groupKey}
                            </span>
                            <span className="status-badge">{group.status}</span>
                            <span className="risk-badge">Risk: {group.riskScore}/100</span>
                          </div>
                          <div className="alert-meta">
                            {fmt(group.created)} &bull; {group.alertCount} alert
                            {group.alertCount !== 1 ? 's' : ''} &bull; Age:{' '}
                            {age.text}
                          </div>

                          {expanded === group.id && (
                            <div className="alert-expanded" onClick={e => e.stopPropagation()}>

                              {/* Overview */}
                              <div className="alert-section">
                                <div className="alert-section-title">DETECTION DETAILS</div>
                                <div className="detail-list">
                                  <div><span className="label">Group ID:</span> <span className="value-mono blue">{group.id}</span></div>
                                  <div><span className="label">Group Key:</span> <span className="value-mono">{group.groupKey}</span></div>
                                  <div><span className="label">Ticket ID:</span> <span className="value-mono orange">{group.ticketId || '—'}</span></div>
                                  <div><span className="label">Alert Count:</span> {group.alertCount}</div>
                                  <div><span className="label">Risk Score:</span>
                                    <span style={{ marginLeft: 8 }}>
                                      <span className={`severity-badge ${severity}`}>{severity.toUpperCase()} ({group.riskScore})</span>
                                    </span>
                                  </div>
                                  <div><span className="label">Created:</span> {fmt(group.created)}</div>
                                  {group.updated && <div><span className="label">Updated:</span> {fmt(group.updated)}</div>}
                                </div>

                                {/* Risk progress bar */}
                                <div style={{ marginTop: 12 }}>
                                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>RISK SCORE</div>
                                  <div className="score-bar" style={{ height: 10 }}>
                                    <div
                                      className={`score-fill ${severity}`}
                                      style={{ width: `${group.riskScore}%` }}
                                    ></div>
                                  </div>
                                </div>
                              </div>

                              {/* Alert Types */}
                              {group.alertTypes.length > 0 && (
                                <div className="alert-section">
                                  <div className="alert-section-title">
                                    <span className="section-icon">🎯</span> ALERT TYPES
                                  </div>
                                  <div className="ioc-tags">
                                    {group.alertTypes.map((t, i) => (
                                      <span key={i} className="ioc-tag">{t}</span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Detection alert object (hostname, username, etc.) */}
                              {group.alert && Object.keys(group.alert).length > 0 && (
                                <div className="alert-section">
                                  <div className="alert-section-title">
                                    <span className="section-icon">🖥️</span> DETECTION DATA
                                  </div>
                                  <div className="detail-list">
                                    {Object.entries(group.alert)
                                      .filter(([, v]) => v !== null && v !== undefined && v !== '')
                                      .map(([k, v]) => (
                                        <div key={k}>
                                          <span className="label">{k}:</span>{' '}
                                          <span className="value-mono">
                                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}

                              {/* Ticket info */}
                              {group.ticket && Object.keys(group.ticket).length > 0 && (
                                <div className="alert-section">
                                  <div className="alert-section-title">
                                    <span className="section-icon">🎫</span> TICKET
                                  </div>
                                  <div className="detail-list">
                                    {Object.entries(group.ticket)
                                      .filter(([, v]) => v !== null && v !== undefined && v !== '')
                                      .map(([k, v]) => (
                                        <div key={k}>
                                          <span className="label">{k}:</span>{' '}
                                          <span className="value-mono">
                                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="alert-expand-icon">
                          {expanded === group.id ? '▼' : '▶'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
            )}

            {/* Closed Detections Tab */}
            {activeTab === 'closed' && (
              <div>
                <h2 className="section-title large">Closed Detections ({closedDetections.length})</h2>
                <ClosedDetectionsViewer
                  detections={closedDetections.map(g => ({
                    id: g.id,
                    tenantId: g.customerId,
                    groupKey: g.groupKey,
                    status: 'RESOLVED' as const,
                    alertCount: g.alertCount,
                    riskScore: g.riskScore,
                    alertTypes: g.alertTypes,
                    createdDate: g.created,
                    resolvedDate: g.updated || undefined,
                    daysOpen: g.updated ? Math.ceil((new Date(g.updated).getTime() - new Date(g.created).getTime()) / (1000 * 60 * 60 * 24)) : undefined,
                    ticketId: g.ticketId
                  }))}
                  isLoading={closedLoading}
                  error={closedError}
                />
              </div>
            )}

            {/* Native Blackpoint Reports Tab */}
            {activeTab === 'native-reports' && (
              <div>
                {reportData ? (
                  <div className="detail-header-card">
                    <div className="card-header" style={{ alignItems: 'flex-start' }}>
                      <div>
                        <h2 className="section-title" style={{ marginBottom: 8 }}>
                          Native Blackpoint Reports
                        </h2>
                        <p className="detail-subtitle" style={{ margin: 0 }}>
                          Report runs from /v1/reports with direct access to PDF URLs and JSON payloads.
                        </p>
                      </div>
                    </div>

                    {reportData.nativeReportsError && (
                      <div className="error-message" style={{ marginTop: 12 }}>
                        ⚠ {reportData.nativeReportsError}
                      </div>
                    )}

                    {reportData.nativeReports.length === 0 ? (
                      <div className="empty-state" style={{ marginTop: 12 }}>
                        No native reports were returned for this tenant.
                      </div>
                    ) : (
                      <div className="table-container" style={{ marginTop: 12 }}>
                        <table className="priority-table">
                          <thead>
                            <tr className="table-header-row">
                              <th className="table-header">TYPE</th>
                              <th className="table-header">INTERVAL</th>
                              <th className="table-header">CREATED</th>
                              <th className="table-header text-right">ACTIONS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.nativeReports.slice(0, 20).map((run) => (
                              <tr key={run.id} className="table-row">
                                <td className="table-cell">
                                  <span className="severity-badge medium">{run.reportType}</span>
                                </td>
                                <td className="table-cell">
                                  {fmtDate(run.intervalStart)} - {fmtDate(run.intervalEnd)}
                                </td>
                                <td className="table-cell">{fmt(run.created)}</td>
                                <td className="table-cell text-right">
                                  <button
                                    className="btn-primary"
                                    disabled={nativeReportActionLoadingId === run.id}
                                    onClick={() => handleOpenNativeReportPdf(run.id)}
                                  >
                                    {nativeReportActionLoadingId === run.id ? 'Opening...' : 'Open PDF'}
                                  </button>
                                  <button
                                    className="btn-primary"
                                    style={{ marginLeft: 8 }}
                                    disabled={nativeReportJsonLoading && selectedNativeReportId === run.id}
                                    onClick={() => handleViewNativeReportJson(run.id)}
                                  >
                                    {selectedNativeReportId === run.id ? 'Hide JSON' : 'View JSON'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {nativeReportActionError && (
                      <div className="error-message" style={{ marginTop: 12 }}>
                        ⚠ {nativeReportActionError}
                      </div>
                    )}

                    {selectedNativeReportId && (
                      <div className="alert-section" style={{ marginTop: 16 }}>
                        <div className="alert-section-title">
                          NATIVE REPORT JSON PREVIEW ({selectedNativeReportId})
                        </div>
                        {nativeReportJsonLoading && (
                          <div className="loading-state">Loading report JSON...</div>
                        )}
                        {nativeReportJsonError && (
                          <div className="error-message">⚠ {nativeReportJsonError}</div>
                        )}
                        {!nativeReportJsonLoading && !nativeReportJsonError && selectedNativeReportJson && (
                          <pre
                            style={{
                              maxHeight: 380,
                              overflow: 'auto',
                              padding: 12,
                              borderRadius: 8,
                              border: '1px solid rgba(148, 163, 184, 0.25)',
                              background: 'rgba(2, 6, 23, 0.65)',
                              color: '#dbeafe',
                              fontSize: 12,
                              lineHeight: 1.45,
                            }}
                          >
                            {JSON.stringify(selectedNativeReportJson, null, 2).slice(0, 12000)}
                            {JSON.stringify(selectedNativeReportJson, null, 2).length > 12000
                              ? '\n\n...truncated for UI preview...'
                              : ''}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>{reportLoading ? 'Loading report...' : reportError ? `Error: ${reportError}` : 'No report data'}</div>
                )}
              </div>
            )}

            {/* Detection Report Tab */}
            {activeTab === 'detection-report' && (
              <div>
                {reportData ? (
                  <DetectionReportingDashboard
                    tenantName={reportData.tenantName}
                    stats={reportData.stats}
                    topAlertTypes={reportData.topAlertTypes}
                    riskScoreDistribution={reportData.riskScoreDistribution}
                    recentClosed={reportData.recentClosed}
                    reportGeneratedAt={reportData.reportGeneratedAt}
                    isLoading={reportLoading}
                  />
                ) : (
                  <div>{reportLoading ? 'Loading report...' : reportError ? `Error: ${reportError}` : 'No report data'}</div>
                )}
              </div>
            )}

            {activeTab === 'xdr' && (
              <TenantXdrOwnershipPanel tenant={tenant} blackpointGroups={groups} />
            )}

            {activeTab === 'security' && (
              <UnifiedSecurityPanel tenantId={tenant.id} tenantName={tenant.name} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tenant card data (main view)
// ---------------------------------------------------------------------------

interface TenantCardData {
  tenant: Tenant;
  openGroups: AlertGroup[];
  totalOpen: number;
  loading: boolean;
  error: string | null;
}

interface AssetCountData {
  devices: number;
  users: number;
  loading: boolean;
}

type Tab = 'overview' | 'detections' | 'tenants';
type SortCol = 'created' | 'riskScore' | 'alertCount';
type SortDir = 'asc' | 'desc';
type SeverityFilter = 'ALL' | 'critical' | 'high' | 'medium' | 'low';
type StatusFilter = 'ALL' | 'OPEN' | 'RESOLVED';

// ---------------------------------------------------------------------------
// Detections View (cross-tenant alert groups with filters)
// ---------------------------------------------------------------------------

interface DetectionsViewProps {
  tenants: Tenant[];
  tenantData: Map<string, TenantCardData>;
}

type AnnotatedGroup = AlertGroup & { tenantName: string };

const DetectionsView: React.FC<DetectionsViewProps> = ({ tenants, tenantData }) => {
  const [selectedTenantId, setSelectedTenantId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [searchText, setSearchText] = useState('');
  const [tenantGroups, setTenantGroups] = useState<AlertGroup[]>([]);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    if (selectedTenantId === 'all') {
      setTenantGroups([]);
      return;
    }
    setTenantLoading(true);
    setTenantError(null);
    setExpanded(null);
    loadAllAlertGroups(selectedTenantId)
      .then(setTenantGroups)
      .catch((e: Error) => setTenantError(e.message))
      .finally(() => setTenantLoading(false));
  }, [selectedTenantId]);

  let groups: AnnotatedGroup[];
  if (selectedTenantId === 'all') {
    groups = [];
    for (const [tid, data] of tenantData) {
      const ten = tenants.find(t => t.id === tid);
      data.openGroups.forEach(g => groups.push({ ...g, tenantName: ten?.name ?? tid }));
    }
  } else {
    const ten = tenants.find(t => t.id === selectedTenantId);
    groups = tenantGroups.map(g => ({ ...g, tenantName: ten?.name ?? selectedTenantId }));
  }

  if (statusFilter !== 'ALL') groups = groups.filter(g => g.status === statusFilter);
  if (severityFilter !== 'ALL') groups = groups.filter(g => riskToSeverity(g.riskScore) === severityFilter);
  if (searchText.trim()) {
    const q = searchText.toLowerCase();
    groups = groups.filter(g =>
      g.alertTypes.some(t => t.toLowerCase().includes(q)) ||
      g.groupKey.toLowerCase().includes(q) ||
      g.tenantName.toLowerCase().includes(q)
    );
  }

  const sorted = [...groups].sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'created') cmp = new Date(a.created).getTime() - new Date(b.created).getTime();
    else if (sortCol === 'riskScore') cmp = a.riskScore - b.riskScore;
    else cmp = a.alertCount - b.alertCount;
    return sortDir === 'desc' ? -cmp : cmp;
  });

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortCol(col); setSortDir('desc'); }
  }

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  groups.forEach(g => { severityCounts[riskToSeverity(g.riskScore)]++; });

  return (
    <div>
      {/* Severity summary pills — click to filter */}
      <div className="severity-summary">
        {(['critical', 'high', 'medium', 'low'] as const).map(sev => (
          <button
            key={sev}
            className={`sev-pill ${sev}${severityFilter === sev ? ' active' : ''}`}
            onClick={() => setSeverityFilter(severityFilter === sev ? 'ALL' : sev)}
          >
            <span className="sev-count">{severityCounts[sev]}</span>
            <span className="sev-label">{sev}</span>
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <select
          value={selectedTenantId}
          onChange={e => { setSelectedTenantId(e.target.value); setExpanded(null); }}
          className="filter-select"
        >
          <option value="all">All Tenants (open preview)</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="filter-select"
        >
          <option value="ALL">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <input
          className="filter-input"
          type="text"
          placeholder="Search alert types, tenants…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
        />
        {searchText && (
          <button className="filter-clear" onClick={() => setSearchText('')}>✕</button>
        )}
      </div>

      {/* Sort + count row */}
      <div className="detections-header">
        <span className="detections-count">
          {sorted.length} detection {sorted.length === 1 ? 'group' : 'groups'}
          {selectedTenantId === 'all' && (
            <span className="preview-note"> — open preview only; select a tenant to load full history</span>
          )}
        </span>
        <div className="sort-controls">
          <span>Sort:</span>
          {(['created', 'riskScore', 'alertCount'] as const).map(col => (
            <button
              key={col}
              className={`sort-btn${sortCol === col ? ' active' : ''}`}
              onClick={() => toggleSort(col)}
            >
              {col === 'created' ? 'Date' : col === 'riskScore' ? 'Risk' : 'Alerts'}
              {sortCol === col && <span>{sortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
            </button>
          ))}
        </div>
      </div>

      {tenantLoading && <div className="loading-state">Loading detection groups…</div>}
      {tenantError && <div className="error-message">⚠ {tenantError}</div>}

      {sorted.length === 0 && !tenantLoading && (
        <div className="empty-state">No detection groups match the current filters.</div>
      )}

      <div className="detections-list">
        {sorted.map(group => {
          const severity = riskToSeverity(group.riskScore);
          const age = getAlertAge(group.created);
          const isOpen = group.status === 'OPEN';
          const isExpanded = expanded === group.id;
          return (
            <div
              key={group.id}
              className={`detection-row${isExpanded ? ' expanded' : ''}`}
              data-severity={severity}
              onClick={() => setExpanded(isExpanded ? null : group.id)}
            >
              <div className="detection-row-main">
                <div className="severity-indicator" data-severity={severity} />
                <div className="detection-info">
                  <div className="detection-title">
                    {group.alertTypes.length > 0 ? group.alertTypes.join(', ') : group.groupKey}
                  </div>
                  <div className="detection-meta">
                    <span className="tenant-tag">{group.tenantName}</span>
                    <span className="meta-sep">•</span>
                    <span>{fmt(group.created)}</span>
                    <span className="meta-sep">•</span>
                    <span>{group.alertCount} alert{group.alertCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div className="detection-badges">
                  <span className={`severity-badge ${severity}`}>{severity}</span>
                  <span className={`status-pill ${isOpen ? 'open' : 'resolved'}`}>{group.status}</span>
                  <span className="age-chip" data-age={age.ageCategory}>{age.text}</span>
                  <span className="risk-chip">⚡ {group.riskScore}</span>
                </div>
                <span className="expand-arrow">{isExpanded ? '▼' : '▶'}</span>
              </div>
              {isExpanded && (
                <div className="detection-expanded" onClick={e => e.stopPropagation()}>
                  <div className="expanded-cols">
                    <div className="expanded-col">
                      <div className="exp-section-title">DETECTION DETAILS</div>
                      <div className="exp-row">
                        <span className="exp-label">Group ID</span>
                        <span className="exp-value mono blue">{group.id}</span>
                      </div>
                      <div className="exp-row">
                        <span className="exp-label">Group Key</span>
                        <span className="exp-value mono">{group.groupKey}</span>
                      </div>
                      <div className="exp-row">
                        <span className="exp-label">Ticket ID</span>
                        <span className="exp-value mono orange">{group.ticketId || '—'}</span>
                      </div>
                      <div className="exp-row">
                        <span className="exp-label">Alert Count</span>
                        <span className="exp-value">{group.alertCount}</span>
                      </div>
                      <div className="exp-row">
                        <span className="exp-label">Tenant</span>
                        <span className="exp-value">{group.tenantName}</span>
                      </div>
                      <div className="exp-row">
                        <span className="exp-label">Created</span>
                        <span className="exp-value">{fmt(group.created)}</span>
                      </div>
                      {group.updated && (
                        <div className="exp-row">
                          <span className="exp-label">Updated</span>
                          <span className="exp-value">{fmt(group.updated)}</span>
                        </div>
                      )}
                    </div>
                    <div className="expanded-col">
                      <div className="exp-section-title">RISK SCORE</div>
                      <div className="risk-score-display">
                        <span className={`severity-badge ${severity}`}>{severity.toUpperCase()}</span>
                        <span className="risk-number">{group.riskScore}/100</span>
                      </div>
                      <div className="score-bar-lg">
                        <div className={`score-fill ${severity}`} style={{ width: `${group.riskScore}%` }} />
                      </div>
                      {group.alertTypes.length > 0 && (
                        <>
                          <div className="exp-section-title" style={{ marginTop: 16 }}>ALERT TYPES</div>
                          <div className="ioc-tags">
                            {group.alertTypes.map((t, i) => (
                              <span key={i} className="ioc-tag">{t}</span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    {group.alert && Object.keys(group.alert).length > 0 && (
                      <div className="expanded-col">
                        <div className="exp-section-title">🖥️ DETECTION DATA</div>
                        {Object.entries(group.alert)
                          .filter(([, v]) => v !== null && v !== undefined && v !== '')
                          .map(([k, v]) => (
                            <div key={k} className="exp-row">
                              <span className="exp-label">{k}</span>
                              <span className="exp-value mono">
                                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantData, setTenantData] = useState<Map<string, TenantCardData>>(new Map());
  const [assetData, setAssetData] = useState<Map<string, AssetCountData>>(new Map());
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const assetsLoadedRef = useRef(false);

  // Load tenants + alert previews on mount
  useEffect(() => {
    loadTenants()
      .then(list => {
        setTenants(list);
        // Kick off alert group previews for each tenant
        list.forEach(t => {
          setTenantData(prev => {
            const next = new Map(prev);
            next.set(t.id, { tenant: t, openGroups: [], totalOpen: 0, loading: true, error: null });
            return next;
          });
          loadAlertGroupPreview(t.id)
            .then(resp => {
              setTenantData(prev => {
                const next = new Map(prev);
                next.set(t.id, {
                  tenant: t,
                  openGroups: resp.items,
                  totalOpen: resp.total,
                  loading: false,
                  error: null,
                });
                return next;
              });
            })
            .catch((e: Error) => {
              setTenantData(prev => {
                const next = new Map(prev);
                next.set(t.id, { tenant: t, openGroups: [], totalOpen: 0, loading: false, error: e.message });
                return next;
              });
            });
        });
      })
      .catch((e: Error) => setTenantsError(e.message))
      .finally(() => setTenantsLoading(false));
  }, []);

  // Lazy-load asset counts when Tenants tab is first opened
  useEffect(() => {
    if (activeTab !== 'tenants' || assetsLoadedRef.current || tenants.length === 0) return;
    assetsLoadedRef.current = true;
    tenants.forEach(t => {
      setAssetData(prev => {
        const next = new Map(prev);
        next.set(t.id, { devices: 0, users: 0, loading: true });
        return next;
      });
      Promise.all([loadAssetCount(t.id, 'DEVICE'), loadAssetCount(t.id, 'USER')])
        .then(([devices, users]) => {
          setAssetData(prev => {
            const next = new Map(prev);
            next.set(t.id, { devices, users, loading: false });
            return next;
          });
        })
        .catch(() => {
          setAssetData(prev => {
            const next = new Map(prev);
            next.set(t.id, { devices: 0, users: 0, loading: false });
            return next;
          });
        });
    });
  }, [activeTab, tenants]);

  if (selectedTenant) {
    return <TenantDetailPage tenant={selectedTenant} onBack={() => setSelectedTenant(null)} />;
  }

  // Computed values for KPI strip
  const allTenantData = Array.from(tenantData.values());
  const totalTenants = tenants.length;
  const totalOpen = allTenantData.reduce((s, d) => s + d.totalOpen, 0);
  const criticalCount = allTenantData.reduce(
    (s, d) => s + d.openGroups.filter(g => riskToSeverity(g.riskScore) === 'critical').length,
    0
  );
  const allOpenGroups = allTenantData.flatMap(d => d.openGroups);
  const oldestGroup = allOpenGroups.length
    ? allOpenGroups.reduce((oldest, g) =>
        new Date(g.created) < new Date(oldest.created) ? g : oldest
      )
    : null;
  const oldestAge = oldestGroup ? getAlertAge(oldestGroup.created) : null;
  const oldestTenant = oldestGroup ? tenants.find(t => t.id === oldestGroup.customerId) : null;

  const sortedTenants = [...tenants].sort((a, b) => {
    const aData = tenantData.get(a.id);
    const bData = tenantData.get(b.id);
    return priorityScore(bData?.openGroups ?? []) - priorityScore(aData?.openGroups ?? []);
  });

  return (
    <div className="dashboard-container">
      {/* ── Header + Tabs ── */}
      <div className="dashboard-header">
        <div className="dashboard-header-content">
          <div className="header-top">
            <h1 className="dashboard-title">🛡️ Blackpoint SOC Monitor</h1>
            <span className={`header-status ${tenantsLoading ? 'loading' : tenantsError ? 'error' : 'ok'}`}>
              {tenantsLoading ? 'Connecting…' : tenantsError ? '⚠ API Error' : '● Live'}
            </span>
          </div>

          <nav className="tab-nav">
            {(
              [
                { id: 'overview', label: '📊 Overview' },
                { id: 'detections', label: '🚨 Detections' },
                { id: 'tenants', label: '🏢 Tenants' },
              ] as const
            ).map(tab => (
              <button
                key={tab.id}
                className={`tab-btn${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="dashboard-content">

        {/* ── Overview Tab ── */}
        {activeTab === 'overview' && (
          <>
            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-label">Monitored Tenants</div>
                <div className="kpi-value green">{tenantsLoading ? '…' : totalTenants}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Open Detections</div>
                <div className="kpi-value orange">{totalOpen}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Critical Risk</div>
                <div className="kpi-value red">{criticalCount}</div>
              </div>
              <div className={`kpi-card ${oldestAge && oldestAge.hours >= 24 ? 'highlight' : ''}`}>
                <div className="kpi-label">Oldest Open (preview)</div>
                <div className="kpi-value" data-age={oldestAge?.ageCategory || 'good'}>
                  {oldestAge ? oldestAge.text : '—'}
                </div>
                {oldestTenant && <div className="kpi-subtitle">{oldestTenant.name}</div>}
              </div>
            </div>

            {tenantsLoading && <div className="loading-state">Loading tenants…</div>}
            {tenantsError && <div className="error-message">⚠ {tenantsError}</div>}

            {sortedTenants.some(t => (tenantData.get(t.id)?.totalOpen ?? 0) > 0) && (
              <div className="priority-section">
                <h2 className="section-title">
                  🚨 Remediation Priority Queue
                  <span className="section-subtitle">(sorted by urgency)</span>
                </h2>
                <div className="table-container">
                  <table className="priority-table">
                    <thead>
                      <tr className="table-header-row">
                        <th className="table-header">PRIORITY</th>
                        <th className="table-header">CLIENT</th>
                        <th className="table-header">OLDEST (PREVIEW)</th>
                        <th className="table-header">SEVERITY</th>
                        <th className="table-header">OPEN DETECTIONS</th>
                        <th className="table-header">PRIORITY SCORE</th>
                        <th className="table-header text-right">ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTenants.map((tenant, index) => {
                        const data = tenantData.get(tenant.id);
                        const open = data?.totalOpen ?? 0;
                        if (open === 0) return null;

                        const openGroups = data?.openGroups ?? [];
                        const oldest = openGroups.length
                          ? openGroups.reduce((o, g) =>
                              new Date(g.created) < new Date(o.created) ? g : o
                            )
                          : null;
                        const age = oldest ? getAlertAge(oldest.created) : null;
                        const topSeverity = oldest ? riskToSeverity(oldest.riskScore) : 'low';
                        const score = priorityScore(openGroups);
                        const criticalCnt = openGroups.filter(g => riskToSeverity(g.riskScore) === 'critical').length;

                        return (
                          <tr
                            key={tenant.id}
                            className={`table-row ${index === 0 ? 'top-priority' : ''}`}
                            onClick={() => setSelectedTenant(tenant)}
                          >
                            <td className="table-cell">
                              <div className={`priority-badge ${index === 0 ? 'first' : index === 1 ? 'second' : 'default'}`}>
                                {index + 1}
                              </div>
                            </td>
                            <td className="table-cell">
                              <div className="client-name">{tenant.name}</div>
                              {tenant.domain && <div className="client-domain">{tenant.domain}</div>}
                            </td>
                            <td className="table-cell" data-age={age?.ageCategory}>
                              {age ? (
                                <div className="age-display">
                                  <span className="age-value">{age.text}</span>
                                  {age.hours >= 24 && <span className="overdue-badge">OVERDUE</span>}
                                </div>
                              ) : data?.loading ? '…' : '—'}
                            </td>
                            <td className="table-cell">
                              {oldest && (
                                <span className={`severity-badge ${topSeverity}`}>{topSeverity}</span>
                              )}
                            </td>
                            <td className="table-cell">
                              <div className="alerts-count">
                                <span className="count-value">{open}</span>
                                {criticalCnt > 0 && (
                                  <span className="critical-note">({criticalCnt} critical)</span>
                                )}
                              </div>
                            </td>
                            <td className="table-cell">
                              <div className="score-display">
                                <div className="score-bar">
                                  <div
                                    className={`score-fill ${score > 300 ? 'critical' : score > 150 ? 'high' : 'medium'}`}
                                    style={{ width: `${Math.min(100, score / 5)}%` }}
                                  />
                                </div>
                                <span className="score-value">{score}</span>
                              </div>
                            </td>
                            <td className="table-cell text-right">
                              <button
                                onClick={e => { e.stopPropagation(); setSelectedTenant(tenant); }}
                                className="btn-primary"
                              >
                                Investigate →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!tenantsLoading && totalOpen === 0 && tenants.length > 0 && (
              <div className="empty-state large">✓ No open detections across all tenants</div>
            )}
          </>
        )}

        {/* ── Detections Tab ── */}
        {activeTab === 'detections' && (
          <>
            <h2 className="section-title large">🚨 Detection Groups</h2>
            <DetectionsView tenants={tenants} tenantData={tenantData} />
          </>
        )}

        {/* ── Tenants Tab ── */}
        {activeTab === 'tenants' && (
          <>
            <h2 className="section-title large">🏢 Monitored Tenants</h2>
            {tenantsLoading && <div className="loading-state">Loading tenants…</div>}
            {tenantsError && <div className="error-message">⚠ {tenantsError}</div>}
            {!tenantsLoading && tenants.length > 0 && (
              <div className="tenant-grid">
                {tenants.map(tenant => {
                  const data = tenantData.get(tenant.id);
                  const assets = assetData.get(tenant.id);
                  const openGroups = data?.openGroups ?? [];
                  const tenantTotalOpen = data?.totalOpen ?? 0;
                  const criticalGroups = openGroups.filter(g => riskToSeverity(g.riskScore) === 'critical');
                  const oldest = openGroups.length
                    ? openGroups.reduce((o, g) =>
                        new Date(g.created) < new Date(o.created) ? g : o
                      )
                    : null;
                  const oldestAge = oldest ? getAlertAge(oldest.created) : null;

                  return (
                    <div
                      key={tenant.id}
                      onClick={() => setSelectedTenant(tenant)}
                      className={`tenant-card ${criticalGroups.length > 0 ? 'critical' : tenantTotalOpen > 0 ? 'warning' : ''}`}
                    >
                      {!data?.loading && tenantTotalOpen > 0 && (
                        <div className={`card-alert-badge ${criticalGroups.length > 0 ? 'critical' : 'warning'}`}>
                          {tenantTotalOpen}
                        </div>
                      )}

                      <div className="card-header">
                        <div className="tenant-avatar">{tenant.name.substring(0, 2)}</div>
                        <div className="tenant-info">
                          <h3 className="tenant-name">{tenant.name}</h3>
                          {tenant.domain && <p className="tenant-domain">{tenant.domain}</p>}
                        </div>
                      </div>

                      <div className="card-stats-grid">
                        <div className="stat-item">
                          <div className="stat-label">Status</div>
                          <div className="stat-value green">● {tenant.status}</div>
                        </div>
                        <div className="stat-item">
                          <div className="stat-label">Open</div>
                          <div className={`stat-value bold ${tenantTotalOpen > 0 ? 'orange' : 'green'}`}>
                            {data?.loading ? '…' : tenantTotalOpen}
                          </div>
                        </div>
                        <div className="stat-item">
                          <div className="stat-label">Critical</div>
                          <div className={`stat-value bold ${criticalGroups.length > 0 ? 'red' : 'green'}`}>
                            {data?.loading ? '…' : criticalGroups.length}
                          </div>
                        </div>
                      </div>

                      {/* Asset counts — lazy loaded when tab opens */}
                      <div className="asset-counts">
                        <div className="asset-item">
                          <span className="asset-icon">🖥️</span>
                          <span className="asset-value">
                            {assets?.loading ? '…' : assets ? assets.devices.toLocaleString() : '—'}
                          </span>
                          <span className="asset-label">devices</span>
                        </div>
                        <div className="asset-sep" />
                        <div className="asset-item">
                          <span className="asset-icon">👤</span>
                          <span className="asset-value">
                            {assets?.loading ? '…' : assets ? assets.users.toLocaleString() : '—'}
                          </span>
                          <span className="asset-label">users</span>
                        </div>
                      </div>

                      {!data?.loading && oldestAge && oldest && (
                        <div
                          className={`oldest-ticket-box ${oldestAge.hours >= 24 ? 'overdue' : ''}`}
                          data-age={oldestAge.ageCategory}
                        >
                          <div className="oldest-ticket-label">OLDEST OPEN DETECTION</div>
                          <div className="oldest-ticket-content">
                            <div>
                              <span className="oldest-ticket-age">{oldestAge.text}</span>
                              {oldestAge.hours >= 24 && (
                                <span className="overdue-badge small">OVERDUE</span>
                              )}
                            </div>
                            <span className={`severity-badge-small ${riskToSeverity(oldest.riskScore)}`}>
                              {riskToSeverity(oldest.riskScore)}
                            </span>
                          </div>
                          <div className="oldest-ticket-title">
                            {oldest.alertTypes.length > 0 ? oldest.alertTypes.join(', ') : oldest.groupKey}
                          </div>
                        </div>
                      )}

                      {!data?.loading && !oldest && (
                        <div className="oldest-ticket-box clear">
                          <span className="clear-text">✓ No open detections</span>
                        </div>
                      )}

                      {data?.loading && (
                        <div className="oldest-ticket-box clear">
                          <span className="clear-text">Loading…</span>
                        </div>
                      )}

                      {data?.error && (
                        <div className="oldest-ticket-box" style={{ borderColor: '#f97316' }}>
                          <span style={{ color: '#f97316', fontSize: 12 }}>⚠ {data.error}</span>
                        </div>
                      )}

                      <div className="card-footer">Created: {fmtDate(tenant.created)}</div>

                      <button
                        onClick={e => { e.stopPropagation(); setSelectedTenant(tenant); }}
                        className="btn-primary full-width"
                      >
                        View Details →
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
};

export default Dashboard;

