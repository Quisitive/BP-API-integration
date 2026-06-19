// ---------------------------------------------------------------------------
// API Client — Unified Backend Hooks
// ---------------------------------------------------------------------------
// Central fetch utilities for the unified backend API. All calls target
// /api/tenants/:alias/* and handle auth headers from MSAL.
// ---------------------------------------------------------------------------

const BASE = '/api/tenants';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Blackpoint (BP) API
// ---------------------------------------------------------------------------

export function bpDetections(alias: string, params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch<unknown[]>(`${BASE}/${alias}/bp/detections${qs}`);
}

export function bpAnalyticsCount(alias: string, status?: string) {
  const qs = status ? `?status=${status}` : '';
  return apiFetch<{ count: number }>(`${BASE}/${alias}/bp/analytics/count${qs}`);
}

export function bpWeeklyTrends(alias: string) {
  return apiFetch<unknown[]>(`${BASE}/${alias}/bp/analytics/weekly-trends`);
}

export function bpTopEntities(alias: string, top = 10) {
  return apiFetch<unknown[]>(`${BASE}/${alias}/bp/analytics/top-entities?top=${top}`);
}

export function bpTopThreats(alias: string, top = 10) {
  return apiFetch<unknown[]>(`${BASE}/${alias}/bp/analytics/top-threats?top=${top}`);
}

export function bpReports(alias: string) {
  return apiFetch<unknown[]>(`${BASE}/${alias}/bp/reports`);
}

export function bpAssets(alias: string) {
  return apiFetch<unknown[]>(`${BASE}/${alias}/bp/assets`);
}

// ---------------------------------------------------------------------------
// Defender XDR API
// ---------------------------------------------------------------------------

export interface IncidentSummary {
  id: string;
  tenantAlias: string;
  title: string;
  severity: string;
  status: string;
  assignedTo?: string;
  createdTime: string;
  lastUpdateTime: string;
  alertsCount: number;
  workloads: string[];
  classification?: string;
  determination?: string;
}

export interface IncidentEvidenceLink {
  label: string;
  url: string;
  source: string;
}

export interface BpDetectionDetail {
  id: string;
  title?: string;
  severity?: string;
  status?: string;
  groupKey?: string;
  alertCount?: number;
  createdAt?: string;
  created?: string;
}

export function xdrIncidents(alias: string, top = 50) {
  return apiFetch<IncidentSummary[]>(`${BASE}/${alias}/xdr/incidents?top=${top}`);
}

export function xdrIncident(alias: string, incidentId: string) {
  return apiFetch<IncidentSummary>(`${BASE}/${alias}/xdr/incidents/${incidentId}`);
}

export function xdrEvidence(alias: string, incidentId: string) {
  return apiFetch<IncidentEvidenceLink[]>(
    `${BASE}/${alias}/xdr/evidence/${incidentId}`,
  );
}

export function bpDetection(alias: string, detectionId: string) {
  return apiFetch<BpDetectionDetail>(`${BASE}/${alias}/bp/detections/${encodeURIComponent(detectionId)}`);
}

export function xdrCreatePlan(alias: string, incidentId: string) {
  return apiFetch<unknown[]>(`${BASE}/${alias}/xdr/remediation/plan`, {
    method: 'POST',
    body: JSON.stringify({ incidentId }),
  });
}

export function xdrProposals(alias: string, incidentId?: string) {
  const qs = incidentId ? `?incidentId=${incidentId}` : '';
  return apiFetch<unknown[]>(`${BASE}/${alias}/xdr/remediation/proposals${qs}`);
}

export function xdrDecideProposal(alias: string, proposalId: string, approved: boolean, reason?: string) {
  return apiFetch<unknown>(`${BASE}/${alias}/xdr/remediation/proposals/${proposalId}/decide`, {
    method: 'POST',
    body: JSON.stringify({ approved, reason }),
  });
}

// ---------------------------------------------------------------------------
// Unified (Correlation, Triage, Closeout, Audit)
// ---------------------------------------------------------------------------

export interface AlertSnapshot {
  id: string;
  tenantAlias: string;
  source: 'blackpoint' | 'defender-xdr';
  sourceId: string;
  title: string;
  severity: string;
  status: string;
  createdAt: string;
  snapshotAt: string;
}

export interface DetectionCorrelation {
  id: string;
  tenantAlias: string;
  bpDetectionId: string;
  xdrIncidentId: string;
  correlationType: string;
  confidence: number;
  createdAt: string;
}

export interface CloseoutRecord {
  id: string;
  tenantAlias: string;
  bpDetectionId?: string;
  xdrIncidentId?: string;
  closedBy: string;
  closedAt: string;
  resolution: string;
  notes?: string;
}

export interface AuditEvent {
  id: string;
  tenantAlias: string;
  incidentId: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface TriageRecommendation {
  id: string;
  title: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  mcpOperation?: {
    action: string;
    target: string;
    parameters: Record<string, unknown>;
  };
  manualSteps?: string[];
}

export function unifiedAlerts(alias: string, limit = 100) {
  return apiFetch<AlertSnapshot[]>(`${BASE}/${alias}/unified/alerts?limit=${limit}`);
}

export function unifiedCorrelations(alias: string) {
  return apiFetch<DetectionCorrelation[]>(`${BASE}/${alias}/unified/correlations`);
}

export function createCorrelation(
  alias: string,
  bpDetectionId: string,
  xdrIncidentId: string,
  correlationType: string,
  confidence: number,
) {
  return apiFetch<DetectionCorrelation>(`${BASE}/${alias}/unified/correlations`, {
    method: 'POST',
    body: JSON.stringify({ bpDetectionId, xdrIncidentId, correlationType, confidence }),
  });
}

export function unifiedCloseouts(alias: string, limit = 50) {
  return apiFetch<CloseoutRecord[]>(`${BASE}/${alias}/unified/closeouts?limit=${limit}`);
}

export function createCloseout(
  alias: string,
  data: { bpDetectionId?: string; xdrIncidentId?: string; resolution: string; notes?: string; closedBy: string },
) {
  return apiFetch<CloseoutRecord>(`${BASE}/${alias}/unified/closeouts`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function unifiedAudit(alias: string, incidentId?: string) {
  const qs = incidentId ? `?incidentId=${incidentId}` : '';
  return apiFetch<AuditEvent[]>(`${BASE}/${alias}/unified/audit${qs}`);
}

export function createUnifiedAuditEvent(
  alias: string,
  data: {
    incidentId: string;
    actor: string;
    action: string;
    details?: Record<string, unknown>;
  },
) {
  return apiFetch<AuditEvent>(`${BASE}/${alias}/unified/audit`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function triageRecommend(alias: string, context: { title: string; severity: string; workloads: string[] }) {
  return apiFetch<TriageRecommendation[]>(`${BASE}/${alias}/unified/triage/recommend`, {
    method: 'POST',
    body: JSON.stringify(context),
  });
}
