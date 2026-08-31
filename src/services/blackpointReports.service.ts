export type BlackpointReportType =
  | 'Cloud'
  | 'Executive'
  | 'MDR'
  | 'VulnerabilityManagement';

export interface BlackpointReportRun {
  id: string;
  reportType: BlackpointReportType;
  intervalStart: string;
  intervalEnd: string;
  created: string;
  updated: string | null;
}

export interface BlackpointPaginationMeta {
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
}

export interface BlackpointReportListResponse {
  data: BlackpointReportRun[];
  meta: BlackpointPaginationMeta;
}

export interface BlackpointReportUrlResponse {
  data: {
    url: string;
  };
}

export interface BlackpointReportBinaryResponse {
  data: {
    base64: string;
  };
}

export interface BlackpointReportJsonResponse {
  data: {
    reportType: BlackpointReportType;
    report: Record<string, unknown>;
  };
}

export interface BlackpointReportListOptions {
  page?: number;
  pageSize?: number;
  sortBy?: 'intervalStart';
  sortOrder?: 'asc' | 'desc';
  /**
   * Filter by report type. Only 'Cloud', 'Executive', 'MDR' are valid filter values
   * per the CompassOne API v1.7.0 spec. 'VulnerabilityManagement' may appear in
   * response data but cannot be used as a query filter.
   */
  reportType?: 'Cloud' | 'Executive' | 'MDR';
  startDate?: string;
  endDate?: string;
}

function getHeaders(tenantId?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (tenantId) {
    headers['x-tenant-id'] = tenantId;
  }

  return headers;
}

function buildQuery(options: BlackpointReportListOptions): string {
  const params = new URLSearchParams();

  if (options.page !== undefined) params.set('page', String(options.page));
  if (options.pageSize !== undefined) params.set('pageSize', String(options.pageSize));
  if (options.sortBy) params.set('sortBy', options.sortBy);
  if (options.sortOrder) params.set('sortOrder', options.sortOrder);
  if (options.reportType) params.set('reportType', options.reportType);
  if (options.startDate) params.set('startDate', options.startDate);
  if (options.endDate) params.set('endDate', options.endDate);

  return params.toString();
}

async function apiFetch<T>(path: string, tenantId?: string): Promise<T> {
  const response = await fetch(path, { headers: getHeaders(tenantId) });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} - ${path}`);
  }

  return (await response.json()) as T;
}

export async function listReportsForTenant(
  tenantId: string,
  options: BlackpointReportListOptions = {}
): Promise<BlackpointReportListResponse> {
  const query = buildQuery({
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 100,
    sortBy: options.sortBy ?? 'intervalStart',
    sortOrder: options.sortOrder ?? 'desc',
    reportType: options.reportType,
    startDate: options.startDate,
    endDate: options.endDate,
  });

  return apiFetch<BlackpointReportListResponse>(`/v1/reports?${query}`, tenantId);
}

export async function getReportUrlForTenant(
  tenantId: string,
  reportId: string
): Promise<BlackpointReportUrlResponse> {
  return apiFetch<BlackpointReportUrlResponse>(
    `/v1/reports/${encodeURIComponent(reportId)}/url`,
    tenantId
  );
}

export async function getReportBinaryForTenant(
  tenantId: string,
  reportId: string
): Promise<BlackpointReportBinaryResponse> {
  return apiFetch<BlackpointReportBinaryResponse>(
    `/v1/reports/${encodeURIComponent(reportId)}/binary`,
    tenantId
  );
}

export async function getReportJsonForTenant(
  tenantId: string,
  reportId: string
): Promise<BlackpointReportJsonResponse> {
  return apiFetch<BlackpointReportJsonResponse>(
    `/v1/reports/${encodeURIComponent(reportId)}/json`,
    tenantId
  );
}
