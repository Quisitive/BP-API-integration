// ---------------------------------------------------------------------------
// Shared Types — XDR & Remediation
// ---------------------------------------------------------------------------
// Unified type definitions ported from SecOps-O365-Command-Dashboard/types.ts
// and extended for the unified SOC platform (BP + XDR correlation).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Defender XDR Types
// ---------------------------------------------------------------------------

export type Workload =
  | 'DefenderForEndpoint'
  | 'DefenderForIdentity'
  | 'DefenderForOffice365'
  | 'DefenderForCloudApps'
  | 'DefenderXdr';

export type IncidentSeverity = 'Informational' | 'Low' | 'Medium' | 'High' | 'Critical';

export type IncidentStatus = 'Active' | 'InProgress' | 'Resolved' | 'Redirected';

export interface IncidentSummary {
  id: string;
  tenantAlias: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  assignedTo?: string;
  createdTime: string;
  lastUpdateTime: string;
  alertsCount: number;
  workloads: Workload[];
  classification?: string;
  determination?: string;
}

export interface CaseWritebackRequest {
  assignedTo?: string;
  status?: IncidentStatus;
  classification?: string;
  determination?: string;
  comment?: string;
  tags?: string[];
}

export interface IncidentEvidenceLink {
  label: string;
  url: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Remediation Types
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface McpOperation {
  action: string;
  target: string;
  parameters: Record<string, unknown>;
}

export interface MitigationRecommendation {
  id: string;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  mcpOperation?: McpOperation;
  manualSteps?: string[];
}

export interface RemediationProposal {
  proposalId: string;
  id: string;
  tenantAlias: string;
  incidentId: string;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  status: ProposalStatus;
  mcpOperation?: McpOperation;
  manualSteps?: string[];
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  executionNote?: string;
}

export interface ApprovalDecision {
  approved: boolean;
  actor: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Storage Types
// ---------------------------------------------------------------------------

export interface CaseRecord extends IncidentSummary {
  lastSyncedAt: string;
}

export interface AuditEvent {
  id: string;
  tenantAlias: string;
  incidentId: string;
  proposalId?: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Blackpoint Detection Types (for correlation)
// ---------------------------------------------------------------------------

export interface BpDetection {
  id: string;
  tenantAlias: string;
  groupKey: string;
  title: string;
  severity: string;
  status: string;
  createdAt: string;
  alertCount: number;
  entities: string[];
}

export interface DetectionCorrelation {
  id: string;
  tenantAlias: string;
  bpDetectionId: string;
  xdrIncidentId: string;
  correlationType: 'entity' | 'temporal' | 'title' | 'analyst-confirmed';
  confidence: number;
  createdAt: string;
}

/** Normalized closeout outcome derived from the free-form resolution value. */
export type Disposition =
  | 'true-positive'
  | 'false-positive'
  | 'benign'
  | 'duplicate'
  | 'informational'
  | 'other';

export interface CloseoutRecord {
  id: string;
  tenantAlias: string;
  bpDetectionId?: string;
  xdrIncidentId?: string;
  closedBy: string;
  closedAt: string;
  resolution: string;
  notes?: string;
  /** Normalized outcome for trend/tuning analytics. */
  disposition?: Disposition;
  /** Alert types of the linked BP detection, captured at close time. */
  alertTypes?: string[];
  /** Creation time of the linked BP detection, for MTTR calculation. */
  detectionCreatedAt?: string;
}

// ---------------------------------------------------------------------------
// Alert Snapshot (cross-source)
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

// ---------------------------------------------------------------------------
// Trend Snapshot (point-in-time metrics for long-term trending)
// ---------------------------------------------------------------------------
// Persisted periodically to build history beyond the Blackpoint 90-day API
// window: detection volume + closeout disposition mix at capture time.

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

// ---------------------------------------------------------------------------
// After Action Report (AAR) — Incident Case Write-Up
// ---------------------------------------------------------------------------

export type RemediationPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type RemediationActionStatus = 'open' | 'in-progress' | 'completed' | 'not-needed';
export type AarStatus = 'draft' | 'final';

/** A single recommended next step for remediation. */
export interface RemediationAction {
  id: string;
  title: string;
  description: string;
  /** By who — owning team or role responsible. */
  owner: string;
  /** Which timeline — target completion window (e.g. "Immediate", "24h", "1 week"). */
  timeline: string;
  /** Which priority to tackle in. */
  priority: RemediationPriority;
  status: RemediationActionStatus;
  /** Whether the action was auto-suggested or authored by the analyst. */
  source: 'auto' | 'analyst';
  riskLevel?: RiskLevel;
}

/** Reference to a source incident/detection/alert included in the report. */
export interface AarSourceRef {
  system: 'blackpoint' | 'defender-xdr';
  kind: 'incident' | 'detection' | 'alert';
  id: string;
  title?: string;
  severity?: string;
  status?: string;
  createdAt?: string;
}

/** A chronological event drawn from the aggregated sources. */
export interface AarTimelineEntry {
  timestamp: string;
  source: 'blackpoint' | 'defender-xdr';
  label: string;
  detail?: string;
}

/** The full Incident After Action Report record. */
export interface AfterActionReport {
  id: string;
  tenantAlias: string;
  title: string;
  status: AarStatus;
  authoredBy: string;
  createdAt: string;
  updatedAt: string;
  /** Highest severity across the aggregated sources. */
  severity: string;
  /** Aggregated source references (BP + XDR incidents/detections/alerts). */
  sources: AarSourceRef[];
  /** Merged chronological timeline. */
  timeline: AarTimelineEntry[];
  /** Distinct impacted assets/entities pulled from the sources. */
  impactedAssets: string[];
  // Narrative sections (analyst-editable) --------------------------------
  executiveSummary: string;
  detectionSummary: string;
  investigationFindings: string;
  containmentActions: string;
  rootCause: string;
  lessonsLearned: string;
  // Recommendations ------------------------------------------------------
  remediationActions: RemediationAction[];
  /** Whether remediation is still outstanding. */
  outstandingRisk: boolean;
}

/** Request body to generate a draft AAR by aggregating sources. */
export interface GenerateAarRequest {
  title?: string;
  authoredBy: string;
  xdrIncidentIds?: string[];
  bpDetectionIds?: string[];
}
