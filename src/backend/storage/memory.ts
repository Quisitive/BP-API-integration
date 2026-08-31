// ---------------------------------------------------------------------------
// Storage — In-Memory Implementation
// ---------------------------------------------------------------------------
// Default storage backend for development and testing. All data lives in
// process memory and is lost on restart.
// ---------------------------------------------------------------------------

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
import type { CaseRepository } from './repository.js';
import { toCaseRecord } from './repository.js';

export class InMemoryCaseRepository implements CaseRepository {
  private cases = new Map<string, CaseRecord>();
  private proposals = new Map<string, RemediationProposal>();
  private auditEvents: AuditEvent[] = [];
  private detections = new Map<string, BpDetection>();
  private correlations: DetectionCorrelation[] = [];
  private closeouts: CloseoutRecord[] = [];
  private alertSnapshots: AlertSnapshot[] = [];
  private trendSnapshots: TrendSnapshot[] = [];
  private reports = new Map<string, AfterActionReport>();

  async init(): Promise<void> {
    // No-op for in-memory
  }

  // -- XDR Incidents --------------------------------------------------------

  async upsertCaseFromIncident(incident: IncidentSummary): Promise<CaseRecord> {
    const key = `${incident.tenantAlias}:${incident.id}`;
    const record = toCaseRecord(incident);
    this.cases.set(key, record);
    return record;
  }

  async listCases(tenantAlias: string, limit = 100): Promise<CaseRecord[]> {
    const results: CaseRecord[] = [];
    for (const record of this.cases.values()) {
      if (record.tenantAlias === tenantAlias) {
        results.push(record);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  async getCase(tenantAlias: string, incidentId: string): Promise<CaseRecord | null> {
    return this.cases.get(`${tenantAlias}:${incidentId}`) ?? null;
  }

  // -- Remediation Proposals ------------------------------------------------

  async saveProposal(proposal: RemediationProposal): Promise<void> {
    this.proposals.set(proposal.proposalId, proposal);
  }

  async getProposal(proposalId: string): Promise<RemediationProposal | null> {
    return this.proposals.get(proposalId) ?? null;
  }

  async listProposals(tenantAlias: string, incidentId?: string): Promise<RemediationProposal[]> {
    const results: RemediationProposal[] = [];
    for (const p of this.proposals.values()) {
      if (p.tenantAlias !== tenantAlias) continue;
      if (incidentId && p.incidentId !== incidentId) continue;
      results.push(p);
    }
    return results;
  }

  // -- Audit Events ---------------------------------------------------------

  async addAuditEvent(event: AuditEvent): Promise<void> {
    this.auditEvents.push(event);
  }

  async listAuditEvents(tenantAlias: string, incidentId?: string): Promise<AuditEvent[]> {
    return this.auditEvents.filter((e) => {
      if (e.tenantAlias !== tenantAlias) return false;
      if (incidentId && e.incidentId !== incidentId) return false;
      return true;
    });
  }

  // -- Blackpoint Detections ------------------------------------------------

  async upsertDetection(detection: BpDetection): Promise<void> {
    this.detections.set(`${detection.tenantAlias}:${detection.id}`, detection);
  }

  async listDetections(tenantAlias: string, limit = 100): Promise<BpDetection[]> {
    const results: BpDetection[] = [];
    for (const d of this.detections.values()) {
      if (d.tenantAlias === tenantAlias) {
        results.push(d);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  async getDetection(tenantAlias: string, detectionId: string): Promise<BpDetection | null> {
    return this.detections.get(`${tenantAlias}:${detectionId}`) ?? null;
  }

  // -- Cross-Source Correlation ---------------------------------------------

  async saveCorrelation(correlation: DetectionCorrelation): Promise<void> {
    this.correlations.push(correlation);
  }

  async listCorrelations(tenantAlias: string): Promise<DetectionCorrelation[]> {
    return this.correlations.filter((c) => c.tenantAlias === tenantAlias);
  }

  async getCorrelationsByDetection(detectionId: string): Promise<DetectionCorrelation[]> {
    return this.correlations.filter((c) => c.bpDetectionId === detectionId);
  }

  async getCorrelationsByIncident(incidentId: string): Promise<DetectionCorrelation[]> {
    return this.correlations.filter((c) => c.xdrIncidentId === incidentId);
  }

  // -- Closeout Governance --------------------------------------------------

  async saveCloseout(record: CloseoutRecord): Promise<void> {
    this.closeouts.push(record);
  }

  async listCloseouts(tenantAlias: string, limit = 100): Promise<CloseoutRecord[]> {
    return this.closeouts
      .filter((c) => c.tenantAlias === tenantAlias)
      .slice(0, limit);
  }

  // -- Alert Snapshots ------------------------------------------------------

  async saveAlertSnapshot(snapshot: AlertSnapshot): Promise<void> {
    this.alertSnapshots.push(snapshot);
  }

  async listAlertSnapshots(tenantAlias: string, limit = 100): Promise<AlertSnapshot[]> {
    return this.alertSnapshots
      .filter((s) => s.tenantAlias === tenantAlias)
      .slice(0, limit);
  }

  // -- Trend Snapshots ------------------------------------------------------

  async saveTrendSnapshot(snapshot: TrendSnapshot): Promise<void> {
    this.trendSnapshots.push(snapshot);
  }

  async listTrendSnapshots(tenantAlias: string, limit = 500): Promise<TrendSnapshot[]> {
    return this.trendSnapshots
      .filter((s) => s.tenantAlias === tenantAlias)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .slice(-limit);
  }

  // -- After Action Reports -------------------------------------------------

  async saveReport(report: AfterActionReport): Promise<void> {
    this.reports.set(`${report.tenantAlias}:${report.id}`, report);
  }

  async getReport(tenantAlias: string, reportId: string): Promise<AfterActionReport | null> {
    return this.reports.get(`${tenantAlias}:${reportId}`) ?? null;
  }

  async listReports(tenantAlias: string, limit = 100): Promise<AfterActionReport[]> {
    return [...this.reports.values()]
      .filter((r) => r.tenantAlias === tenantAlias)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async deleteReport(tenantAlias: string, reportId: string): Promise<void> {
    this.reports.delete(`${tenantAlias}:${reportId}`);
  }
}
