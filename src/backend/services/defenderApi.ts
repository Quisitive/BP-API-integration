// ---------------------------------------------------------------------------
// Defender XDR API Client
// ---------------------------------------------------------------------------
// Ported from SecOps-O365-Command-Dashboard/defenderApi.ts and adapted for
// the unified tenant config schema. Acquires tokens per-tenant using MSAL
// confidential client flow (client_credentials grant).
// ---------------------------------------------------------------------------

import { ConfidentialClientApplication } from '@azure/msal-node';
import type { UnifiedTenantConfig, MicrosoftTenantConfig } from '../config/tenants.schema.js';
import type {
  IncidentSummary,
  IncidentStatus,
  IncidentSeverity,
  Workload,
  CaseWritebackRequest,
  IncidentEvidenceLink,
} from '../types.js';

// ---------------------------------------------------------------------------
// Token Cache (per tenant)
// ---------------------------------------------------------------------------

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

async function acquireToken(ms: MicrosoftTenantConfig, scope: string): Promise<string> {
  const cacheKey = `${ms.tenantId}:${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: ms.clientId,
      clientSecret: ms.clientSecret,
      authority: `https://login.microsoftonline.com/${ms.tenantId}`,
    },
  });

  const result = await cca.acquireTokenByClientCredential({ scopes: [scope] });
  if (!result?.accessToken) {
    throw new Error(`Failed to acquire token for tenant ${ms.tenantId}, scope ${scope}`);
  }

  tokenCache.set(cacheKey, {
    accessToken: result.accessToken,
    expiresAt: Date.now() + (result.expiresOn ? result.expiresOn.getTime() - Date.now() : 3500_000),
  });

  return result.accessToken;
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

const GRAPH_SECURITY_BASE = 'https://graph.microsoft.com/v1.0/security';

export class DefenderApiClient {
  // -------------------------------------------------------------------------
  // Incidents
  // -------------------------------------------------------------------------

  async listIncidents(
    tenant: UnifiedTenantConfig,
    params?: { top?: number; filter?: string },
  ): Promise<IncidentSummary[]> {
    const ms = this.requireMicrosoft(tenant);
    const qs = new URLSearchParams();
    if (params?.top) qs.set('$top', String(params.top));
    if (params?.filter) qs.set('$filter', params.filter);

    const url = `${this.securityApiBase(ms)}/incidents${qs.toString() ? '?' + qs.toString() : ''}`;
    const data = await this.requestSecurityApi<{ value: RawIncident[] }>(ms, url);
    return (data.value || []).map((i) => this.mapIncident(tenant.alias, i));
  }

  async getIncident(tenant: UnifiedTenantConfig, incidentId: string): Promise<IncidentSummary> {
    const ms = this.requireMicrosoft(tenant);
    const url = `${this.securityApiBase(ms)}/incidents/${encodeURIComponent(incidentId)}`;
    const raw = await this.requestSecurityApi<RawIncident>(ms, url);
    return this.mapIncident(tenant.alias, raw);
  }

  async updateIncident(
    tenant: UnifiedTenantConfig,
    incidentId: string,
    update: CaseWritebackRequest,
  ): Promise<void> {
    const ms = this.requireMicrosoft(tenant);
    const url = `${this.securityApiBase(ms)}/incidents/${encodeURIComponent(incidentId)}`;
    const body: Record<string, unknown> = {};
    if (update.assignedTo !== undefined) body.assignedTo = update.assignedTo;
    if (update.status !== undefined) body.status = this.mapStatusToApi(update.status);
    if (update.classification !== undefined) body.classification = update.classification;
    if (update.determination !== undefined) body.determination = update.determination;
    if (update.tags !== undefined) body.customTags = update.tags;

    await this.requestSecurityApi<unknown>(ms, url, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  // -------------------------------------------------------------------------
  // Evidence Links (deep-link URLs for portal navigation)
  // -------------------------------------------------------------------------

  async getIncidentEvidenceLinks(
    tenant: UnifiedTenantConfig,
    incidentId: string,
  ): Promise<IncidentEvidenceLink[]> {
    const ms = this.requireMicrosoft(tenant);
    const portalBase = `https://security.microsoft.com/tenants/${ms.tenantId}`;

    const links: IncidentEvidenceLink[] = [
      {
        label: 'Incident in M365 Defender',
        url: `${portalBase}/incidents/${incidentId}`,
        source: 'defender-portal',
      },
    ];

    // Fetch alerts for additional deep links
    const alertsUrl = `${GRAPH_SECURITY_BASE}/incidents/${encodeURIComponent(incidentId)}/alerts`;
    try {
      const alertData = await this.requestGraphApi<{ value: RawAlert[] }>(ms, alertsUrl);
      for (const alert of alertData.value || []) {
        links.push({
          label: `Alert: ${alert.title || alert.id}`,
          url: `${portalBase}/alerts/${alert.id}`,
          source: 'defender-alert',
        });
      }
    } catch {
      // Non-fatal: portal link is still useful
    }

    return links;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireMicrosoft(tenant: UnifiedTenantConfig): MicrosoftTenantConfig {
    if (!tenant.microsoft) {
      throw new Error(`Tenant "${tenant.alias}" has no Microsoft configuration`);
    }
    return tenant.microsoft;
  }

  private securityApiBase(ms: MicrosoftTenantConfig): string {
    return ms.securityApiHost
      ? `${ms.securityApiHost}/api`
      : `${GRAPH_SECURITY_BASE}`;
  }

  private async requestSecurityApi<T>(
    ms: MicrosoftTenantConfig,
    url: string,
    init?: RequestInit,
  ): Promise<T> {
    const scope = ms.securityApiHost
      ? `${ms.securityApiHost}/.default`
      : 'https://graph.microsoft.com/.default';
    const token = await acquireToken(ms, scope);

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    if (!response.ok) {
      throw new Error(`Defender API error: ${response.status} on ${init?.method || 'GET'} ${url}`);
    }

    return (await response.json()) as T;
  }

  private async requestGraphApi<T>(ms: MicrosoftTenantConfig, url: string): Promise<T> {
    const token = await acquireToken(ms, 'https://graph.microsoft.com/.default');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Graph API error: ${response.status} on GET ${url}`);
    }

    return (await response.json()) as T;
  }

  private mapIncident(tenantAlias: string, raw: RawIncident): IncidentSummary {
    return {
      id: String(raw.id),
      tenantAlias,
      title: raw.displayName || raw.incidentName || '',
      severity: this.normalizeSeverity(raw.severity),
      status: this.normalizeStatus(raw.status),
      assignedTo: raw.assignedTo || undefined,
      createdTime: raw.createdDateTime || '',
      lastUpdateTime: raw.lastUpdateDateTime || raw.lastModifiedDateTime || '',
      alertsCount: raw.alerts?.length ?? 0,
      workloads: this.inferWorkloads(raw),
      classification: raw.classification || undefined,
      determination: raw.determination || undefined,
    };
  }

  private normalizeSeverity(raw?: string): IncidentSeverity {
    const map: Record<string, IncidentSeverity> = {
      informational: 'Informational',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      critical: 'Critical',
    };
    return map[(raw || '').toLowerCase()] || 'Medium';
  }

  private normalizeStatus(raw?: string): IncidentStatus {
    const map: Record<string, IncidentStatus> = {
      active: 'Active',
      inprogress: 'InProgress',
      in_progress: 'InProgress',
      resolved: 'Resolved',
      redirected: 'Redirected',
    };
    return map[(raw || '').toLowerCase().replace(/\s/g, '')] || 'Active';
  }

  private mapStatusToApi(status: IncidentStatus): string {
    const map: Record<IncidentStatus, string> = {
      Active: 'active',
      InProgress: 'inProgress',
      Resolved: 'resolved',
      Redirected: 'redirected',
    };
    return map[status] || 'active';
  }

  private inferWorkloads(raw: RawIncident): Workload[] {
    const workloads = new Set<Workload>();
    for (const alert of raw.alerts || []) {
      const source = (alert.serviceSource || alert.detectionSource || '').toLowerCase();
      if (source.includes('endpoint')) workloads.add('DefenderForEndpoint');
      else if (source.includes('identity')) workloads.add('DefenderForIdentity');
      else if (source.includes('office')) workloads.add('DefenderForOffice365');
      else if (source.includes('cloud') || source.includes('app')) workloads.add('DefenderForCloudApps');
      else workloads.add('DefenderXdr');
    }
    return workloads.size > 0 ? [...workloads] : ['DefenderXdr'];
  }
}

// ---------------------------------------------------------------------------
// Raw API response shapes
// ---------------------------------------------------------------------------

interface RawIncident {
  id: string | number;
  displayName?: string;
  incidentName?: string;
  severity?: string;
  status?: string;
  assignedTo?: string;
  createdDateTime?: string;
  lastUpdateDateTime?: string;
  lastModifiedDateTime?: string;
  classification?: string;
  determination?: string;
  alerts?: RawAlert[];
}

interface RawAlert {
  id: string;
  title?: string;
  serviceSource?: string;
  detectionSource?: string;
}
