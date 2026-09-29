// ---------------------------------------------------------------------------
// CompassOne API Client — Blackpoint Cyber v1.7.0
// ---------------------------------------------------------------------------
// Typed HTTP client for the CompassOne REST API. Uses per-tenant customerId
// from UnifiedTenantConfig.blackpoint to scope requests via x-tenant-id header.
// Auth: Bearer token from COMPASSONE_API_KEY env var (account-level) or the
// tenant-specific apiKeyOverride.
// ---------------------------------------------------------------------------

import type { UnifiedTenantConfig } from '../config/tenants.schema.js';
import { logger, redactPath } from '../utils/logger.js';
import { recordUpstream } from '../utils/metrics.js';

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

/** Error carrying the upstream CompassOne HTTP status and response body. */
export class CompassOneApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'CompassOneApiError';
  }
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
  // Capability probe (endpoint discovery)
  // -------------------------------------------------------------------------

  /**
   * Issue a lightweight GET against an arbitrary read-only path to test whether
   * the API key can reach it. Never throws and never emits upstream.error logs —
   * a 403/404 is an expected outcome during capability discovery. The response
   * body is cancelled without being parsed to keep probes cheap.
   */
  async probe(opts: {
    path: string;
    scope: 'account' | 'tenant';
    tenant?: UnifiedTenantConfig;
    timeoutMs?: number;
  }): Promise<{ status: number; ok: boolean; error?: string }> {
    const { path, scope, tenant } = opts;
    const base = scope === 'tenant' && tenant ? this.resolveBaseUrl(tenant) : this.baseUrl;
    const key = scope === 'tenant' && tenant ? this.resolveApiKey(tenant) : this.apiKey;

    if (!key) return { status: 0, ok: false, error: 'no_api_key' };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    if (scope === 'tenant') {
      const customerId = tenant?.blackpoint?.customerId;
      if (!customerId) return { status: 0, ok: false, error: 'no_customer_id' };
      headers['x-tenant-id'] = customerId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
    const start = Date.now();
    try {
      const response = await fetch(`${base}/v1${path}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      await response.body?.cancel().catch(() => undefined);
      logger.debug('discovery.probe', {
        provider: 'compassone',
        path: redactPath(path),
        scope,
        status: response.status,
        durationMs: Date.now() - start,
      });
      return { status: response.status, ok: response.ok };
    } catch (err) {
      return { status: 0, ok: false, error: (err as Error).message };
    } finally {
      clearTimeout(timer);
    }
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

    const logPath = redactPath(path + (qs && qs.toString() ? `?${qs.toString()}` : ''));
    const start = Date.now();
    try {
      const response = await fetch(url, { method: 'GET', headers });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        recordUpstream('compassone', false, response.status, Date.now() - start);
        logger.warn('upstream.error', {
          provider: 'compassone',
          method: 'GET',
          path: logPath,
          status: response.status,
          tenantAlias: tenant.alias,
          durationMs: Date.now() - start,
        });
        throw new CompassOneApiError(
          `CompassOne API error: ${response.status} ${response.statusText} on GET ${path}`,
          response.status,
          body,
        );
      }

      const data = (await response.json()) as T;
      recordUpstream('compassone', true, response.status, Date.now() - start);
      logger.info('upstream.call', {
        provider: 'compassone',
        method: 'GET',
        path: logPath,
        status: response.status,
        tenantAlias: tenant.alias,
        durationMs: Date.now() - start,
      });
      return data;
    } catch (err) {
      if (err instanceof CompassOneApiError) throw err;
      recordUpstream('compassone', false, 0, Date.now() - start);
      logger.error('upstream.failure', {
        provider: 'compassone',
        method: 'GET',
        path: logPath,
        tenantAlias: tenant.alias,
        durationMs: Date.now() - start,
        error: (err as Error).message,
      });
      throw err;
    }
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

    const logPath = redactPath(path + (qs && qs.toString() ? `?${qs.toString()}` : ''));
    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        recordUpstream('compassone', false, response.status, Date.now() - start);
        logger.warn('upstream.error', {
          provider: 'compassone',
          method: 'GET',
          path: logPath,
          status: response.status,
          tenantAlias: 'account',
          durationMs: Date.now() - start,
        });
        throw new CompassOneApiError(
          `CompassOne API error: ${response.status} ${response.statusText} on GET ${path}`,
          response.status,
          body,
        );
      }

      const data = (await response.json()) as T;
      recordUpstream('compassone', true, response.status, Date.now() - start);
      logger.info('upstream.call', {
        provider: 'compassone',
        method: 'GET',
        path: logPath,
        status: response.status,
        tenantAlias: 'account',
        durationMs: Date.now() - start,
      });
      return data;
    } catch (err) {
      if (err instanceof CompassOneApiError) throw err;
      recordUpstream('compassone', false, 0, Date.now() - start);
      logger.error('upstream.failure', {
        provider: 'compassone',
        method: 'GET',
        path: logPath,
        tenantAlias: 'account',
        durationMs: Date.now() - start,
        error: (err as Error).message,
      });
      throw err;
    }
  }
}
