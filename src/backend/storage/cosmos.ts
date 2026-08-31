// ---------------------------------------------------------------------------
// Storage — Azure Cosmos DB Implementation
// ---------------------------------------------------------------------------
// Uses @azure/cosmos SDK with a single database and per-entity containers.
// Partition key is /tenantAlias for all containers (optimal for tenant-scoped
// queries). Falls back to DATABASE_URL connection string or explicit env vars.
// ---------------------------------------------------------------------------

import { CosmosClient, Container, Database } from '@azure/cosmos';
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

const CONTAINERS = [
  'cases',
  'proposals',
  'auditEvents',
  'bpDetections',
  'correlations',
  'closeouts',
  'alertSnapshots',
  'afterActionReports',
] as const;

export class CosmosCaseRepository implements CaseRepository {
  private client: CosmosClient;
  private db!: Database;
  private containers = new Map<string, Container>();

  constructor(connectionString?: string) {
    const cs = connectionString || process.env.COSMOS_CONNECTION_STRING;
    if (!cs) {
      throw new Error('COSMOS_CONNECTION_STRING environment variable required');
    }
    this.client = new CosmosClient(cs);
  }

  async init(): Promise<void> {
    const dbName = process.env.COSMOS_DATABASE || 'secops-unified';
    const { database } = await this.client.databases.createIfNotExists({ id: dbName });
    this.db = database;

    for (const name of CONTAINERS) {
      const { container } = await this.db.containers.createIfNotExists({
        id: name,
        partitionKey: { paths: ['/tenantAlias'] },
      });
      this.containers.set(name, container);
    }
  }

  // -- XDR Incidents --------------------------------------------------------

  async upsertCaseFromIncident(incident: IncidentSummary): Promise<CaseRecord> {
    const record = toCaseRecord(incident);
    const container = this.container('cases');
    await container.items.upsert({ ...record, id: record.id });
    return record;
  }

  async listCases(tenantAlias: string, limit = 100): Promise<CaseRecord[]> {
    const container = this.container('cases');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.tenantAlias = @t ORDER BY c.lastSyncedAt DESC OFFSET 0 LIMIT @l',
        parameters: [
          { name: '@t', value: tenantAlias },
          { name: '@l', value: limit },
        ],
      })
      .fetchAll();
    return resources as CaseRecord[];
  }

  async getCase(tenantAlias: string, incidentId: string): Promise<CaseRecord | null> {
    const container = this.container('cases');
    try {
      const { resource } = await container.item(incidentId, tenantAlias).read();
      return (resource as CaseRecord) ?? null;
    } catch {
      return null;
    }
  }

  // -- Remediation Proposals ------------------------------------------------

  async saveProposal(proposal: RemediationProposal): Promise<void> {
    const container = this.container('proposals');
    await container.items.upsert({ ...proposal, id: proposal.proposalId });
  }

  async getProposal(proposalId: string): Promise<RemediationProposal | null> {
    const container = this.container('proposals');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.proposalId = @id',
        parameters: [{ name: '@id', value: proposalId }],
      })
      .fetchAll();
    return resources.length > 0 ? (resources[0] as RemediationProposal) : null;
  }

  async listProposals(tenantAlias: string, incidentId?: string): Promise<RemediationProposal[]> {
    const container = this.container('proposals');
    let query = 'SELECT * FROM c WHERE c.tenantAlias = @t';
    const params: Array<{ name: string; value: unknown }> = [{ name: '@t', value: tenantAlias }];
    if (incidentId) {
      query += ' AND c.incidentId = @i';
      params.push({ name: '@i', value: incidentId });
    }
    query += ' ORDER BY c.createdAt DESC';
    const { resources } = await container.items.query({ query, parameters: params }).fetchAll();
    return resources as RemediationProposal[];
  }

  // -- Audit Events ---------------------------------------------------------

  async addAuditEvent(event: AuditEvent): Promise<void> {
    const container = this.container('auditEvents');
    await container.items.create({ ...event });
  }

  async listAuditEvents(tenantAlias: string, incidentId?: string): Promise<AuditEvent[]> {
    const container = this.container('auditEvents');
    let query = 'SELECT * FROM c WHERE c.tenantAlias = @t';
    const params: Array<{ name: string; value: unknown }> = [{ name: '@t', value: tenantAlias }];
    if (incidentId) {
      query += ' AND c.incidentId = @i';
      params.push({ name: '@i', value: incidentId });
    }
    query += ' ORDER BY c.createdAt DESC';
    const { resources } = await container.items.query({ query, parameters: params }).fetchAll();
    return resources as AuditEvent[];
  }

  // -- Blackpoint Detections ------------------------------------------------

  async upsertDetection(detection: BpDetection): Promise<void> {
    const container = this.container('bpDetections');
    await container.items.upsert({ ...detection, id: detection.id });
  }

  async listDetections(tenantAlias: string, limit = 100): Promise<BpDetection[]> {
    const container = this.container('bpDetections');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.tenantAlias = @t OFFSET 0 LIMIT @l',
        parameters: [
          { name: '@t', value: tenantAlias },
          { name: '@l', value: limit },
        ],
      })
      .fetchAll();
    return resources as BpDetection[];
  }

  async getDetection(tenantAlias: string, detectionId: string): Promise<BpDetection | null> {
    const container = this.container('bpDetections');
    try {
      const { resource } = await container.item(detectionId, tenantAlias).read();
      return (resource as BpDetection) ?? null;
    } catch {
      return null;
    }
  }

  // -- Cross-Source Correlation ---------------------------------------------

  async saveCorrelation(correlation: DetectionCorrelation): Promise<void> {
    const container = this.container('correlations');
    await container.items.upsert({ ...correlation });
  }

  async listCorrelations(tenantAlias: string): Promise<DetectionCorrelation[]> {
    const container = this.container('correlations');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.tenantAlias = @t ORDER BY c.createdAt DESC',
        parameters: [{ name: '@t', value: tenantAlias }],
      })
      .fetchAll();
    return resources as DetectionCorrelation[];
  }

  async getCorrelationsByDetection(detectionId: string): Promise<DetectionCorrelation[]> {
    const container = this.container('correlations');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.bpDetectionId = @id',
        parameters: [{ name: '@id', value: detectionId }],
      })
      .fetchAll();
    return resources as DetectionCorrelation[];
  }

  async getCorrelationsByIncident(incidentId: string): Promise<DetectionCorrelation[]> {
    const container = this.container('correlations');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.xdrIncidentId = @id',
        parameters: [{ name: '@id', value: incidentId }],
      })
      .fetchAll();
    return resources as DetectionCorrelation[];
  }

  // -- Closeout Governance --------------------------------------------------

  async saveCloseout(record: CloseoutRecord): Promise<void> {
    const container = this.container('closeouts');
    await container.items.create({ ...record });
  }

  async listCloseouts(tenantAlias: string, limit = 100): Promise<CloseoutRecord[]> {
    const container = this.container('closeouts');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.tenantAlias = @t ORDER BY c.closedAt DESC OFFSET 0 LIMIT @l',
        parameters: [
          { name: '@t', value: tenantAlias },
          { name: '@l', value: limit },
        ],
      })
      .fetchAll();
    return resources as CloseoutRecord[];
  }

  // -- Alert Snapshots ------------------------------------------------------

  async saveAlertSnapshot(snapshot: AlertSnapshot): Promise<void> {
    const container = this.container('alertSnapshots');
    await container.items.create({ ...snapshot });
  }

  async listAlertSnapshots(tenantAlias: string, limit = 100): Promise<AlertSnapshot[]> {
    const container = this.container('alertSnapshots');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.tenantAlias = @t ORDER BY c.snapshotAt DESC OFFSET 0 LIMIT @l',
        parameters: [
          { name: '@t', value: tenantAlias },
          { name: '@l', value: limit },
        ],
      })
      .fetchAll();
    return resources as AlertSnapshot[];
  }

  // -- Trend Snapshots ------------------------------------------------------

  async saveTrendSnapshot(snapshot: TrendSnapshot): Promise<void> {
    const container = this.container('trendSnapshots');
    await container.items.create({ ...snapshot });
  }

  async listTrendSnapshots(tenantAlias: string, limit = 500): Promise<TrendSnapshot[]> {
    const container = this.container('trendSnapshots');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.tenantAlias = @t ORDER BY c.capturedAt ASC OFFSET 0 LIMIT @l',
        parameters: [
          { name: '@t', value: tenantAlias },
          { name: '@l', value: limit },
        ],
      })
      .fetchAll();
    return resources as TrendSnapshot[];
  }

  // -- After Action Reports -------------------------------------------------

  async saveReport(report: AfterActionReport): Promise<void> {
    const container = this.container('afterActionReports');
    await container.items.upsert({ ...report, id: report.id });
  }

  async getReport(tenantAlias: string, reportId: string): Promise<AfterActionReport | null> {
    const container = this.container('afterActionReports');
    try {
      const { resource } = await container.item(reportId, tenantAlias).read();
      return (resource as AfterActionReport) ?? null;
    } catch {
      return null;
    }
  }

  async listReports(tenantAlias: string, limit = 100): Promise<AfterActionReport[]> {
    const container = this.container('afterActionReports');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.tenantAlias = @t ORDER BY c.updatedAt DESC OFFSET 0 LIMIT @l',
        parameters: [
          { name: '@t', value: tenantAlias },
          { name: '@l', value: limit },
        ],
      })
      .fetchAll();
    return resources as AfterActionReport[];
  }

  async deleteReport(tenantAlias: string, reportId: string): Promise<void> {
    const container = this.container('afterActionReports');
    try {
      await container.item(reportId, tenantAlias).delete();
    } catch {
      // already gone
    }
  }

  // -- Internal -------------------------------------------------------------

  private container(name: string): Container {
    const c = this.containers.get(name);
    if (!c) throw new Error(`Container "${name}" not initialized. Call init() first.`);
    return c;
  }
}
