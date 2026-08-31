// ---------------------------------------------------------------------------
// Storage — Repository Interface
// ---------------------------------------------------------------------------
// Defines the CaseRepository contract for persisting XDR incidents, BP
// detections, remediation proposals, audit events, and cross-source
// correlation records. Extends the original O365 Dashboard pattern with
// Blackpoint correlation and closeout governance methods.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type {
  CaseRecord,
  IncidentSummary,
  RemediationProposal,
  AuditEvent,
  BpDetection,
  DetectionCorrelation,
  CloseoutRecord,
  AlertSnapshot,
  TrendSnapshot,
  AfterActionReport,
} from '../types.js';

// ---------------------------------------------------------------------------
// Core Interface
// ---------------------------------------------------------------------------

export interface CaseRepository {
  /** Initialize connection / ensure tables exist */
  init(): Promise<void>;

  // -- XDR Incidents (Cases) ------------------------------------------------
  upsertCaseFromIncident(incident: IncidentSummary): Promise<CaseRecord>;
  listCases(tenantAlias: string, limit?: number): Promise<CaseRecord[]>;
  getCase(tenantAlias: string, incidentId: string): Promise<CaseRecord | null>;

  // -- Remediation Proposals ------------------------------------------------
  saveProposal(proposal: RemediationProposal): Promise<void>;
  getProposal(proposalId: string): Promise<RemediationProposal | null>;
  listProposals(tenantAlias: string, incidentId?: string): Promise<RemediationProposal[]>;

  // -- Audit Events ---------------------------------------------------------
  addAuditEvent(event: AuditEvent): Promise<void>;
  listAuditEvents(tenantAlias: string, incidentId?: string): Promise<AuditEvent[]>;

  // -- Blackpoint Detections ------------------------------------------------
  upsertDetection(detection: BpDetection): Promise<void>;
  listDetections(tenantAlias: string, limit?: number): Promise<BpDetection[]>;
  getDetection(tenantAlias: string, detectionId: string): Promise<BpDetection | null>;

  // -- Cross-Source Correlation ---------------------------------------------
  saveCorrelation(correlation: DetectionCorrelation): Promise<void>;
  listCorrelations(tenantAlias: string): Promise<DetectionCorrelation[]>;
  getCorrelationsByDetection(detectionId: string): Promise<DetectionCorrelation[]>;
  getCorrelationsByIncident(incidentId: string): Promise<DetectionCorrelation[]>;

  // -- Closeout Governance --------------------------------------------------
  saveCloseout(record: CloseoutRecord): Promise<void>;
  listCloseouts(tenantAlias: string, limit?: number): Promise<CloseoutRecord[]>;

  // -- Alert Snapshots (cross-source timeline) ------------------------------
  saveAlertSnapshot(snapshot: AlertSnapshot): Promise<void>;
  listAlertSnapshots(tenantAlias: string, limit?: number): Promise<AlertSnapshot[]>;

  // -- Trend Snapshots (long-term metric history) ---------------------------
  saveTrendSnapshot(snapshot: TrendSnapshot): Promise<void>;
  listTrendSnapshots(tenantAlias: string, limit?: number): Promise<TrendSnapshot[]>;

  // -- After Action Reports (case write-ups) --------------------------------
  saveReport(report: AfterActionReport): Promise<void>;
  getReport(tenantAlias: string, reportId: string): Promise<AfterActionReport | null>;
  listReports(tenantAlias: string, limit?: number): Promise<AfterActionReport[]>;
  deleteReport(tenantAlias: string, reportId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toCaseRecord(incident: IncidentSummary): CaseRecord {
  return {
    ...incident,
    lastSyncedAt: new Date().toISOString(),
  };
}

export function newAuditEvent(input: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
  return {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
}
