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

/** Plain-object shape used to persist/restore the full repository state. */
export interface RepositoryState {
  cases: CaseRecord[];
  proposals: RemediationProposal[];
  auditEvents: AuditEvent[];
  detections: BpDetection[];
  correlations: DetectionCorrelation[];
  closeouts: CloseoutRecord[];
  alertSnapshots: AlertSnapshot[];
  trendSnapshots: TrendSnapshot[];
  reports: AfterActionReport[];
}

export class InMemoryCaseRepository implements CaseRepository {
  protected cases = new Map<string, CaseRecord>();
  protected proposals = new Map<string, RemediationProposal>();
  protected auditEvents: AuditEvent[] = [];
  protected detections = new Map<string, BpDetection>();
  protected correlations: DetectionCorrelation[] = [];
  protected closeouts: CloseoutRecord[] = [];
  protected alertSnapshots: AlertSnapshot[] = [];
  protected trendSnapshots: TrendSnapshot[] = [];
  protected reports = new Map<string, AfterActionReport>();

  async init(): Promise<void> {
    // No-op for in-memory
  }

  /** Persistence hook — no-op in memory; file/db subclasses override. */
  protected async persist(): Promise<void> {
    // No-op for in-memory
  }

  /** Snapshot the full state as plain arrays for serialization. */
  protected serializeState(): RepositoryState {
    return {
      cases: [...this.cases.values()],
      proposals: [...this.proposals.values()],
      auditEvents: this.auditEvents,
      detections: [...this.detections.values()],
      correlations: this.correlations,
      closeouts: this.closeouts,
      alertSnapshots: this.alertSnapshots,
      trendSnapshots: this.trendSnapshots,
      reports: [...this.reports.values()],
    };
  }

  /** Replace in-memory state from a previously serialized snapshot. */
  protected hydrateState(state: Partial<RepositoryState>): void {
    this.cases = new Map((state.cases ?? []).map((c) => [`${c.tenantAlias}:${c.id}`, c]));
    this.proposals = new Map((state.proposals ?? []).map((p) => [p.proposalId, p]));
    this.auditEvents = state.auditEvents ?? [];
    this.detections = new Map((state.detections ?? []).map((d) => [`${d.tenantAlias}:${d.id}`, d]));
    this.correlations = state.correlations ?? [];
    this.closeouts = state.closeouts ?? [];
    this.alertSnapshots = state.alertSnapshots ?? [];
    this.trendSnapshots = state.trendSnapshots ?? [];
    this.reports = new Map((state.reports ?? []).map((r) => [`${r.tenantAlias}:${r.id}`, r]));
  }

  // -- XDR Incidents --------------------------------------------------------

  async upsertCaseFromIncident(incident: IncidentSummary): Promise<CaseRecord> {
    const key = `${incident.tenantAlias}:${incident.id}`;
    const record = toCaseRecord(incident);
    this.cases.set(key, record);
    await this.persist();
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
    await this.persist();
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
    await this.persist();
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
    await this.persist();
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
    await this.persist();
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
    await this.persist();
  }

  async listCloseouts(tenantAlias: string, limit = 100): Promise<CloseoutRecord[]> {
    return this.closeouts
      .filter((c) => c.tenantAlias === tenantAlias)
      .slice(0, limit);
  }

  // -- Alert Snapshots ------------------------------------------------------

  async saveAlertSnapshot(snapshot: AlertSnapshot): Promise<void> {
    this.alertSnapshots.push(snapshot);
    await this.persist();
  }

  async listAlertSnapshots(tenantAlias: string, limit = 100): Promise<AlertSnapshot[]> {
    return this.alertSnapshots
      .filter((s) => s.tenantAlias === tenantAlias)
      .slice(0, limit);
  }

  // -- Trend Snapshots ------------------------------------------------------

  async saveTrendSnapshot(snapshot: TrendSnapshot): Promise<void> {
    this.trendSnapshots.push(snapshot);
    await this.persist();
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
    await this.persist();
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
    await this.persist();
  }
}
