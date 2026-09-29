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

export interface AlertTypeInsight {
  alertType: string;
  total: number;
  truePositive: number;
  falsePositive: number;
  benign: number;
  duplicate: number;
  informational: number;
  other: number;
  noise: number;
  fpRate: number;
  noiseRate: number;
  avgMttrHours: number | null;
  isTuningCandidate: boolean;
}

export interface TuningInsights {
  generatedAt: string;
  totalCloseouts: number;
  overall: {
    truePositive: number;
    falsePositive: number;
    benign: number;
    duplicate: number;
    informational: number;
    other: number;
    fpRate: number;
    noiseRate: number;
    avgMttrHours: number | null;
  };
  dispositionSummary: { disposition: string; count: number }[];
  byAlertType: AlertTypeInsight[];
  tuningCandidates: AlertTypeInsight[];
  mttrByType: { alertType: string; avgMttrHours: number }[];
  thresholds: { minSample: number; noiseRateThreshold: number };
}

export function bpTuningInsights(alias: string) {
  return apiFetch<TuningInsights>(`${BASE}/${alias}/bp/analytics/tuning-insights`);
}

export interface TuningTicket {
  alertType: string;
  title: string;
  priority: 'P1' | 'P2' | 'P3';
  summary: string;
  recommendation: string;
  evidence: {
    total: number;
    falsePositive: number;
    noise: number;
    fpRate: number;
    noiseRate: number;
    avgMttrHours: number | null;
  };
  labels: string[];
}

export function bpTuningTickets(alias: string) {
  return apiFetch<{ generatedAt: string; count: number; tickets: TuningTicket[] }>(
    `${BASE}/${alias}/bp/analytics/tuning-tickets`,
  );
}

/** Direct URL for the CSV download (opened in a new tab / anchor href). */
export function bpTuningTicketsCsvUrl(alias: string) {
  return `${BASE}/${alias}/bp/analytics/tuning-tickets?format=csv`;
}

export interface TrendSnapshot {
  id: string;
  tenantAlias: string;
  capturedAt: string;
  openDetections: number;
  resolvedDetections: number;
  totalDetections: number;
  closeoutCount: number;
  dispositionCounts: Record<string, number>;
}

export function bpSnapshots(alias: string, limit = 500) {
  return apiFetch<TrendSnapshot[]>(`${BASE}/${alias}/bp/analytics/snapshots?limit=${limit}`);
}

export function bpCaptureSnapshot(alias: string) {
  return apiFetch<TrendSnapshot>(`${BASE}/${alias}/bp/analytics/snapshots`, { method: 'POST' });
}

export interface CorrelationTrends {
  generatedAt: string;
  totalCorrelations: number;
  distinctBpDetections: number;
  distinctXdrIncidents: number;
  avgConfidence: number;
  byWeek: { week: string; count: number }[];
  byType: { type: string; count: number }[];
}

export function correlationTrends(alias: string) {
  return apiFetch<CorrelationTrends>(`${BASE}/${alias}/unified/correlations/trends`);
}

export interface SnapshotAnomaly {
  capturedAt: string;
  metric: 'openDetections' | 'totalDetections' | 'noiseRate';
  severity: 'low' | 'medium' | 'high';
  value: number;
  baseline: number;
  deltaPct: number;
  zScore: number;
  message: string;
}

export interface AnomalyReport {
  generatedAt: string;
  snapshotCount: number;
  anomalies: SnapshotAnomaly[];
  thresholds: { window: number; zThreshold: number; minDeltaPct: number; minAbsolute: number };
}

export function bpAnomalies(alias: string) {
  return apiFetch<AnomalyReport>(`${BASE}/${alias}/bp/analytics/anomalies`);
}

export interface CorrelationCandidate {
  bpDetectionId: string;
  xdrIncidentId: string;
  bpTitle: string;
  xdrTitle: string;
  correlationType: 'entity' | 'temporal' | 'title';
  confidence: number;
  reasons: string[];
}

export function correlationCandidates(alias: string) {
  return apiFetch<CorrelationCandidate[]>(`${BASE}/${alias}/unified/correlations/candidates`);
}

export interface CisoReport {
  generatedAt: string;
  tenantAlias: string;
  tenantName: string;
  kpis: {
    totalCloseouts: number;
    falsePositiveRate: number;
    noiseRate: number;
    avgMttrHours: number | null;
    openDetections: number;
    detectionTrendPct: number | null;
    totalCorrelations: number;
    avgCorrelationConfidence: number;
    highSeverityAnomalies: number;
  };
  topNoisyRules: { alertType: string; noiseRate: number; total: number }[];
  highlights: { label: string; detail: string }[];
  recommendations: string[];
}

export function cisoReport(alias: string) {
  return apiFetch<CisoReport>(`${BASE}/${alias}/unified/reports/ciso`);
}

/** Direct URL for the Markdown download (opened in a new tab / anchor href). */
export function cisoReportMarkdownUrl(alias: string) {
  return `${BASE}/${alias}/unified/reports/ciso?format=md`;
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
  disposition?: string;
  alertTypes?: string[];
  detectionCreatedAt?: string;
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

// ---------------------------------------------------------------------------
// After Action Reports (Incident Case Write-Up)
// ---------------------------------------------------------------------------

export type RemediationPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type RemediationActionStatus = 'open' | 'in-progress' | 'completed' | 'not-needed';
export type AarStatus = 'draft' | 'final';

export interface RemediationAction {
  id: string;
  title: string;
  description: string;
  owner: string;
  timeline: string;
  priority: RemediationPriority;
  status: RemediationActionStatus;
  source: 'auto' | 'analyst';
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

export interface AarSourceRef {
  system: 'blackpoint' | 'defender-xdr';
  kind: 'incident' | 'detection' | 'alert';
  id: string;
  title?: string;
  severity?: string;
  status?: string;
  createdAt?: string;
}

export interface AarTimelineEntry {
  timestamp: string;
  source: 'blackpoint' | 'defender-xdr';
  label: string;
  detail?: string;
}

export interface AfterActionReport {
  id: string;
  tenantAlias: string;
  title: string;
  status: AarStatus;
  authoredBy: string;
  createdAt: string;
  updatedAt: string;
  severity: string;
  sources: AarSourceRef[];
  timeline: AarTimelineEntry[];
  impactedAssets: string[];
  executiveSummary: string;
  detectionSummary: string;
  investigationFindings: string;
  containmentActions: string;
  rootCause: string;
  lessonsLearned: string;
  remediationActions: RemediationAction[];
  outstandingRisk: boolean;
}

export interface GenerateAarRequest {
  title?: string;
  authoredBy: string;
  xdrIncidentIds?: string[];
  bpDetectionIds?: string[];
}

export function listReports(alias: string, limit = 50) {
  return apiFetch<AfterActionReport[]>(`${BASE}/${alias}/unified/reports?limit=${limit}`);
}

export function getReport(alias: string, reportId: string) {
  return apiFetch<AfterActionReport>(`${BASE}/${alias}/unified/reports/${reportId}`);
}

export function generateReport(alias: string, body: GenerateAarRequest) {
  return apiFetch<AfterActionReport>(`${BASE}/${alias}/unified/reports/generate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function saveReport(alias: string, report: AfterActionReport) {
  return apiFetch<AfterActionReport>(`${BASE}/${alias}/unified/reports/${report.id}`, {
    method: 'PUT',
    body: JSON.stringify(report),
  });
}

export function finalizeReport(alias: string, reportId: string, actor: string) {
  return apiFetch<AfterActionReport>(`${BASE}/${alias}/unified/reports/${reportId}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ actor }),
  });
}

export function deleteReport(alias: string, reportId: string) {
  return fetch(`${BASE}/${alias}/unified/reports/${reportId}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
  });
}

/** Build the export download URL for markdown or html. */
export function reportExportUrl(alias: string, reportId: string, format: 'markdown' | 'html') {
  return `${BASE}/${encodeURIComponent(alias)}/unified/reports/${encodeURIComponent(reportId)}/export?format=${format}`;
}