// ---------------------------------------------------------------------------
// CompassOne API Client — Blackpoint Cyber v1.7.0
// ---------------------------------------------------------------------------
// Typed HTTP client for the CompassOne REST API. Uses per-tenant customerId
// from UnifiedTenantConfig.blackpoint to scope requests via x-tenant-id header.
// Auth: Bearer token from COMPASSONE_API_KEY env var (account-level) or the
// tenant-specific apiKeyOverride.
// ---------------------------------------------------------------------------

import type { UnifiedTenantConfig } from '../config/tenants.schema.js';

// ---------------------------------------------------------------------------
// Types (mirrors legacy/types/blackpoint.types.ts relevant subsets)
// ---------------------------------------------------------------------------

export type AlertStatus = 'OPEN' | 'RESOLVED';

export interface AlertGroup {
  id: string;
  customerId: string;
  groupKey: string;
  riskScore: number;
  alertCount: number;
  alertTypes: string[];
  status: AlertStatus;
  ticketId: string;
  ticket?: { status: string; created: string };
  alert?: { id: string; hostname?: string; username?: string } | null;
  created: string;
  updated?: string | null;
}

export interface AlertGroupsListResponse {
  items: AlertGroup[];
  total: number;
  start: number;
  end: number;
  take?: number;
  skip?: number;
}

export interface DetectionAlert {
  id: string;
  customerId: string;
  documentId: string;
  alertGroupId: string;
  riskScore: number;
  hostname?: string | null;
  username?: string | null;
  ruleName?: string | null;
  created: string;
  updated?: string | null;
}

export interface AlertListResponse {
  items: DetectionAlert[];
  total: number;
  start: number;
  end: number;
}

export interface AlertGroupsByWeekEntry {
  date: string;
  count: number;
}

export interface TopDetectionsByEntityEntry {
  name: string;
  count: number;
}

export interface TopDetectionsByThreatEntry {
  name: string;
  count: number;
  percentage: number;
}

export interface ReportRun {
  id: string;
  reportType: string;
  intervalStart: string;
  intervalEnd: string;
  created: string;
  updated: string | null;
}

export interface ReportRunListResponse {
  data: ReportRun[];
  meta: { currentPage: number; pageSize: number; totalPages: number; totalItems: number };
}

export interface AssetPageMeta {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  totalPages: number;
}

export interface Asset {
  id: string;
  hostname: string;
  os?: string;
  lastSeen?: string;
  [key: string]: unknown;
}

export interface AssetListResponse {
  data: Asset[];
  meta: AssetPageMeta;
}

export interface CompassOneTenant {
  id: string;
  name: string;
}

export interface CompassOneTenantListResponse {
  data: CompassOneTenant[];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface CompassOneClientOptions {
  baseUrl?: string;
  apiKey?: string;
}

export class CompassOneClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts?: CompassOneClientOptions) {
    this.baseUrl = opts?.baseUrl || process.env.COMPASSONE_API_URL || 'https://api.blackpointcyber.com';
    this.apiKey = opts?.apiKey || process.env.COMPASSONE_API_KEY || '';
  }

  // -------------------------------------------------------------------------
  // Tenants (account-level)
  // -------------------------------------------------------------------------

  async listTenants(params?: { pageSize?: number }): Promise<CompassOneTenantListResponse> {
    const qs = new URLSearchParams();
    if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
    return this.getAccountLevel<CompassOneTenantListResponse>('/tenants', qs);
  }

  // -------------------------------------------------------------------------
  // Alert Groups (Detections)
  // -------------------------------------------------------------------------

  async listDetections(
    tenant: UnifiedTenantConfig,
    params?: { status?: AlertStatus[]; skip?: number; take?: number },
  ): Promise<AlertGroupsListResponse> {
    const qs = new URLSearchParams();
    if (params?.skip != null) qs.set('skip', String(params.skip));
    if (params?.take != null) qs.set('take', String(params.take));
    if (params?.status) {
      for (const s of params.status) qs.append('status', s);
    }
    return this.get<AlertGroupsListResponse>(tenant, '/alert-groups', qs);
  }

  async getDetection(tenant: UnifiedTenantConfig, alertGroupId: string): Promise<AlertGroup> {
    return this.get<AlertGroup>(tenant, `/alert-groups/${encodeURIComponent(alertGroupId)}`);
  }

  async getAlerts(
    tenant: UnifiedTenantConfig,
    alertGroupId: string,
    params?: { skip?: number; take?: number },
  ): Promise<AlertListResponse> {
    const qs = new URLSearchParams();
    if (params?.skip != null) qs.set('skip', String(params.skip));
    if (params?.take != null) qs.set('take', String(params.take));
    return this.get<AlertListResponse>(
      tenant,
      `/alert-groups/${encodeURIComponent(alertGroupId)}/alerts`,
      qs,
    );
  }

  async getDetectionCount(tenant: UnifiedTenantConfig, status?: AlertStatus): Promise<number> {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    const res = await this.get<{ count: number }>(tenant, '/alert-groups/count', qs);
    return res.count;
  }

  async getWeeklyTrends(tenant: UnifiedTenantConfig): Promise<AlertGroupsByWeekEntry[]> {
    return this.get<AlertGroupsByWeekEntry[]>(tenant, '/alert-groups/alert-groups-by-week');
  }

  async getTopEntities(
    tenant: UnifiedTenantConfig,
    params?: { top?: number },
  ): Promise<TopDetectionsByEntityEntry[]> {
    const qs = new URLSearchParams();
    if (params?.top != null) qs.set('top', String(params.top));
    return this.get<TopDetectionsByEntityEntry[]>(tenant, '/alert-groups/top-detections-by-entity', qs);
  }

  async getTopThreats(
    tenant: UnifiedTenantConfig,
    params?: { top?: number },
  ): Promise<TopDetectionsByThreatEntry[]> {
    const qs = new URLSearchParams();
    if (params?.top != null) qs.set('top', String(params.top));
    return this.get<TopDetectionsByThreatEntry[]>(tenant, '/alert-groups/top-detections-by-threat', qs);
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  async listReports(
    tenant: UnifiedTenantConfig,
    params?: { reportType?: string; page?: number; pageSize?: number },
  ): Promise<ReportRunListResponse> {
    const qs = new URLSearchParams();
    if (params?.reportType) qs.set('reportType', params.reportType);
    if (params?.page != null) qs.set('page', String(params.page));
    if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
    return this.get<ReportRunListResponse>(tenant, '/reports', qs);
  }

  async getReportPdfUrl(tenant: UnifiedTenantConfig, reportId: string): Promise<string> {
    const res = await this.get<{ data: { url: string } }>(
      tenant,
      `/reports/${encodeURIComponent(reportId)}/url`,
    );
    return res.data.url;
  }

  async getReportJson(tenant: UnifiedTenantConfig, reportId: string): Promise<Record<string, unknown>> {
    const res = await this.get<{ data: { report: Record<string, unknown> } }>(
      tenant,
      `/reports/${encodeURIComponent(reportId)}/json`,
    );
    return res.data.report;
  }

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  async listAssets(
    tenant: UnifiedTenantConfig,
    params?: { page?: number; pageSize?: number },
  ): Promise<AssetListResponse> {
    const qs = new URLSearchParams();
    if (params?.page != null) qs.set('page', String(params.page));
    if (params?.pageSize != null) qs.set('pageSize', String(params.pageSize));
    return this.get<AssetListResponse>(tenant, '/assets', qs);
  }

  async getAssetCount(tenant: UnifiedTenantConfig): Promise<number> {
    const res = await this.listAssets(tenant, { page: 1, pageSize: 1 });
    return res.meta.totalItems;
  }

  // -------------------------------------------------------------------------
  // Internal HTTP helpers
  // -------------------------------------------------------------------------

  private resolveApiKey(tenant: UnifiedTenantConfig): string {
    return tenant.blackpoint?.apiKeyOverride || this.apiKey;
  }

  private resolveBaseUrl(tenant: UnifiedTenantConfig): string {
    return tenant.blackpoint?.apiBaseUrl || this.baseUrl;
  }

  private async get<T>(
    tenant: UnifiedTenantConfig,
    path: string,
    qs?: URLSearchParams,
  ): Promise<T> {
    const base = this.resolveBaseUrl(tenant);
    const key = this.resolveApiKey(tenant);
    const customerId = tenant.blackpoint?.customerId;

    if (!customerId) {
      throw new Error(`Tenant "${tenant.alias}" has no Blackpoint customerId configured`);
    }
    if (!key) {
      throw new Error('CompassOne API key is not configured');
    }

    let url = `${base}/v1${path}`;
    if (qs && qs.toString()) {
      url += `?${qs.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'x-tenant-id': customerId,
    };

    const response = await fetch(url, { method: 'GET', headers });

    if (!response.ok) {
      throw new Error(
        `CompassOne API error: ${response.status} ${response.statusText} on GET ${path}`,
      );
    }

    return (await response.json()) as T;
  }

  private async getAccountLevel<T>(path: string, qs?: URLSearchParams): Promise<T> {
    const key = this.apiKey;
    if (!key) {
      throw new Error('CompassOne API key is not configured');
    }

    let url = `${this.baseUrl}/v1${path}`;
    if (qs && qs.toString()) {
      url += `?${qs.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `CompassOne API error: ${response.status} ${response.statusText} on GET ${path}`,
      );
    }

    return (await response.json()) as T;
  }
}
