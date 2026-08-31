// ---------------------------------------------------------------------------
// Storage — PostgreSQL Implementation
// ---------------------------------------------------------------------------
// Production-grade storage using node-postgres (pg). Tables are auto-created
// on init(). Uses parameterized queries exclusively (SQL injection safe).
// ---------------------------------------------------------------------------

import pg from 'pg';
import type {
  CaseRecord,
  IncidentSummary,
  RemediationProposal,
  AuditEvent,
  BpDetection,
  DetectionCorrelation,
  CloseoutRecord,
  TrendSnapshot,
  AlertSnapshot,
  AfterActionReport,
} from '../types.js';
import type { CaseRepository } from './repository.js';
import { toCaseRecord } from './repository.js';

const { Pool } = pg;

export class PostgresCaseRepository implements CaseRepository {
  private pool: pg.Pool;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cases (
        tenant_alias TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        data JSONB NOT NULL,
        last_synced_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (tenant_alias, incident_id)
      );

      CREATE TABLE IF NOT EXISTS proposals (
        proposal_id TEXT PRIMARY KEY,
        tenant_alias TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        tenant_alias TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bp_detections (
        tenant_alias TEXT NOT NULL,
        detection_id TEXT NOT NULL,
        data JSONB NOT NULL,
        PRIMARY KEY (tenant_alias, detection_id)
      );

      CREATE TABLE IF NOT EXISTS correlations (
        id TEXT PRIMARY KEY,
        tenant_alias TEXT NOT NULL,
        bp_detection_id TEXT NOT NULL,
        xdr_incident_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS closeouts (
        id TEXT PRIMARY KEY,
        tenant_alias TEXT NOT NULL,
        data JSONB NOT NULL,
        closed_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS alert_snapshots (
        id TEXT PRIMARY KEY,
        tenant_alias TEXT NOT NULL,
        source TEXT NOT NULL,
        data JSONB NOT NULL,
        snapshot_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS after_action_reports (
        id TEXT NOT NULL,
        tenant_alias TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (tenant_alias, id)
      );

      CREATE TABLE IF NOT EXISTS trend_snapshots (
        id TEXT PRIMARY KEY,
        tenant_alias TEXT NOT NULL,
        data JSONB NOT NULL,
        captured_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_proposals_tenant ON proposals(tenant_alias, incident_id);
      CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_alias, incident_id);
      CREATE INDEX IF NOT EXISTS idx_correlations_detection ON correlations(bp_detection_id);
      CREATE INDEX IF NOT EXISTS idx_correlations_incident ON correlations(xdr_incident_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_tenant ON alert_snapshots(tenant_alias);
      CREATE INDEX IF NOT EXISTS idx_trend_snapshots_tenant ON trend_snapshots(tenant_alias);
    `);
  }

  // -- XDR Incidents --------------------------------------------------------

  async upsertCaseFromIncident(incident: IncidentSummary): Promise<CaseRecord> {
    const record = toCaseRecord(incident);
    await this.pool.query(
      `INSERT INTO cases (tenant_alias, incident_id, data, last_synced_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_alias, incident_id)
       DO UPDATE SET data = $3, last_synced_at = NOW()`,
      [record.tenantAlias, record.id, JSON.stringify(record)],
    );
    return record;
  }

  async listCases(tenantAlias: string, limit = 100): Promise<CaseRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM cases WHERE tenant_alias = $1 ORDER BY last_synced_at DESC LIMIT $2`,
      [tenantAlias, limit],
    );
    return rows.map((r) => r.data as CaseRecord);
  }

  async getCase(tenantAlias: string, incidentId: string): Promise<CaseRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT data FROM cases WHERE tenant_alias = $1 AND incident_id = $2`,
      [tenantAlias, incidentId],
    );
    return rows.length > 0 ? (rows[0].data as CaseRecord) : null;
  }

  // -- Remediation Proposals ------------------------------------------------

  async saveProposal(proposal: RemediationProposal): Promise<void> {
    await this.pool.query(
      `INSERT INTO proposals (proposal_id, tenant_alias, incident_id, data, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (proposal_id)
       DO UPDATE SET data = $4`,
      [proposal.proposalId, proposal.tenantAlias, proposal.incidentId, JSON.stringify(proposal), proposal.createdAt],
    );
  }

  async getProposal(proposalId: string): Promise<RemediationProposal | null> {
    const { rows } = await this.pool.query(
      `SELECT data FROM proposals WHERE proposal_id = $1`,
      [proposalId],
    );
    return rows.length > 0 ? (rows[0].data as RemediationProposal) : null;
  }

  async listProposals(tenantAlias: string, incidentId?: string): Promise<RemediationProposal[]> {
    if (incidentId) {
      const { rows } = await this.pool.query(
        `SELECT data FROM proposals WHERE tenant_alias = $1 AND incident_id = $2 ORDER BY created_at DESC`,
        [tenantAlias, incidentId],
      );
      return rows.map((r) => r.data as RemediationProposal);
    }
    const { rows } = await this.pool.query(
      `SELECT data FROM proposals WHERE tenant_alias = $1 ORDER BY created_at DESC`,
      [tenantAlias],
    );
    return rows.map((r) => r.data as RemediationProposal);
  }

  // -- Audit Events ---------------------------------------------------------

  async addAuditEvent(event: AuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (id, tenant_alias, incident_id, data, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [event.id, event.tenantAlias, event.incidentId, JSON.stringify(event), event.createdAt],
    );
  }

  async listAuditEvents(tenantAlias: string, incidentId?: string): Promise<AuditEvent[]> {
    if (incidentId) {
      const { rows } = await this.pool.query(
        `SELECT data FROM audit_events WHERE tenant_alias = $1 AND incident_id = $2 ORDER BY created_at DESC`,
        [tenantAlias, incidentId],
      );
      return rows.map((r) => r.data as AuditEvent);
    }
    const { rows } = await this.pool.query(
      `SELECT data FROM audit_events WHERE tenant_alias = $1 ORDER BY created_at DESC LIMIT 500`,
      [tenantAlias],
    );
    return rows.map((r) => r.data as AuditEvent);
  }

  // -- Blackpoint Detections ------------------------------------------------

  async upsertDetection(detection: BpDetection): Promise<void> {
    await this.pool.query(
      `INSERT INTO bp_detections (tenant_alias, detection_id, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_alias, detection_id)
       DO UPDATE SET data = $3`,
      [detection.tenantAlias, detection.id, JSON.stringify(detection)],
    );
  }

  async listDetections(tenantAlias: string, limit = 100): Promise<BpDetection[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM bp_detections WHERE tenant_alias = $1 LIMIT $2`,
      [tenantAlias, limit],
    );
    return rows.map((r) => r.data as BpDetection);
  }

  async getDetection(tenantAlias: string, detectionId: string): Promise<BpDetection | null> {
    const { rows } = await this.pool.query(
      `SELECT data FROM bp_detections WHERE tenant_alias = $1 AND detection_id = $2`,
      [tenantAlias, detectionId],
    );
    return rows.length > 0 ? (rows[0].data as BpDetection) : null;
  }

  // -- Cross-Source Correlation ---------------------------------------------

  async saveCorrelation(correlation: DetectionCorrelation): Promise<void> {
    await this.pool.query(
      `INSERT INTO correlations (id, tenant_alias, bp_detection_id, xdr_incident_id, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET data = $5`,
      [correlation.id, correlation.tenantAlias, correlation.bpDetectionId, correlation.xdrIncidentId, JSON.stringify(correlation), correlation.createdAt],
    );
  }

  async listCorrelations(tenantAlias: string): Promise<DetectionCorrelation[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM correlations WHERE tenant_alias = $1 ORDER BY created_at DESC`,
      [tenantAlias],
    );
    return rows.map((r) => r.data as DetectionCorrelation);
  }

  async getCorrelationsByDetection(detectionId: string): Promise<DetectionCorrelation[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM correlations WHERE bp_detection_id = $1`,
      [detectionId],
    );
    return rows.map((r) => r.data as DetectionCorrelation);
  }

  async getCorrelationsByIncident(incidentId: string): Promise<DetectionCorrelation[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM correlations WHERE xdr_incident_id = $1`,
      [incidentId],
    );
    return rows.map((r) => r.data as DetectionCorrelation);
  }

  // -- Closeout Governance --------------------------------------------------

  async saveCloseout(record: CloseoutRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO closeouts (id, tenant_alias, data, closed_at)
       VALUES ($1, $2, $3, $4)`,
      [record.id, record.tenantAlias, JSON.stringify(record), record.closedAt],
    );
  }

  async listCloseouts(tenantAlias: string, limit = 100): Promise<CloseoutRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM closeouts WHERE tenant_alias = $1 ORDER BY closed_at DESC LIMIT $2`,
      [tenantAlias, limit],
    );
    return rows.map((r) => r.data as CloseoutRecord);
  }

  // -- Alert Snapshots ------------------------------------------------------

  async saveAlertSnapshot(snapshot: AlertSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO alert_snapshots (id, tenant_alias, source, data, snapshot_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [snapshot.id, snapshot.tenantAlias, snapshot.source, JSON.stringify(snapshot), snapshot.snapshotAt],
    );
  }

  async listAlertSnapshots(tenantAlias: string, limit = 100): Promise<AlertSnapshot[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM alert_snapshots WHERE tenant_alias = $1 ORDER BY snapshot_at DESC LIMIT $2`,
      [tenantAlias, limit],
    );
    return rows.map((r) => r.data as AlertSnapshot);
  }

  // -- Trend Snapshots ------------------------------------------------------

  async saveTrendSnapshot(snapshot: TrendSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO trend_snapshots (id, tenant_alias, data, captured_at)
       VALUES ($1, $2, $3, $4)`,
      [snapshot.id, snapshot.tenantAlias, JSON.stringify(snapshot), snapshot.capturedAt],
    );
  }

  async listTrendSnapshots(tenantAlias: string, limit = 500): Promise<TrendSnapshot[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM trend_snapshots WHERE tenant_alias = $1 ORDER BY captured_at ASC LIMIT $2`,
      [tenantAlias, limit],
    );
    return rows.map((r) => r.data as TrendSnapshot);
  }

  // -- After Action Reports -------------------------------------------------

  async saveReport(report: AfterActionReport): Promise<void> {
    await this.pool.query(
      `INSERT INTO after_action_reports (id, tenant_alias, data, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_alias, id)
       DO UPDATE SET data = $3, updated_at = NOW()`,
      [report.id, report.tenantAlias, JSON.stringify(report)],
    );
  }

  async getReport(tenantAlias: string, reportId: string): Promise<AfterActionReport | null> {
    const { rows } = await this.pool.query(
      `SELECT data FROM after_action_reports WHERE tenant_alias = $1 AND id = $2`,
      [tenantAlias, reportId],
    );
    return rows.length > 0 ? (rows[0].data as AfterActionReport) : null;
  }

  async listReports(tenantAlias: string, limit = 100): Promise<AfterActionReport[]> {
    const { rows } = await this.pool.query(
      `SELECT data FROM after_action_reports WHERE tenant_alias = $1 ORDER BY updated_at DESC LIMIT $2`,
      [tenantAlias, limit],
    );
    return rows.map((r) => r.data as AfterActionReport);
  }

  async deleteReport(tenantAlias: string, reportId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM after_action_reports WHERE tenant_alias = $1 AND id = $2`,
      [tenantAlias, reportId],
    );
  }
}
