// ---------------------------------------------------------------------------
// Service — CompassOne Endpoint Discovery
// ---------------------------------------------------------------------------
// Periodically probes a curated catalog of read-only CompassOne endpoints that
// are NOT yet integrated into the app. When Blackpoint enables an endpoint for
// our API key (status flips from 403/404 to 2xx), it is flagged as "newly
// available" and logged so the capability can be pulled into reporting.
//
// Probes are GET-only, body-cancelled, and never mutate remote state. Gated
// behind ENABLE_ENDPOINT_DISCOVERY=true so dev runs don't call the BP API.
// ---------------------------------------------------------------------------

import { CompassOneClient } from './compassOneClient.js';
import { logger } from '../utils/logger.js';
import type { UnifiedTenantConfig } from '../config/tenants.schema.js';

export type ProbeAvailability =
  | 'available'
  | 'forbidden'
  | 'not_found'
  | 'unauthorized'
  | 'error';

export interface EndpointCatalogEntry {
  id: string;
  domain: string;
  path: string;
  scope: 'account' | 'tenant';
  /** True if the app already consumes this endpoint (probed as a control). */
  integrated: boolean;
  description: string;
}

export interface EndpointProbeResult {
  id: string;
  domain: string;
  path: string;
  scope: 'account' | 'tenant';
  integrated: boolean;
  description: string;
  availability: ProbeAvailability;
  status: number;
  tenantAlias?: string;
  checkedAt: string;
  /** True when this probe transitioned into "available" on the latest run. */
  newlyAvailable: boolean;
}

export interface DiscoveryReport {
  lastRunAt: string | null;
  running: boolean;
  totalProbes: number;
  availableCount: number;
  integratableCount: number;
  results: EndpointProbeResult[];
  newlyAvailable: EndpointProbeResult[];
}

// ---------------------------------------------------------------------------
// Catalog — read-only, parameter-free GET endpoints worth watching.
// Sourced from COMPASSONE_API_GAP_ANALYSIS.md (v1.7.0). Only list/collection
// and stats endpoints are included; anything requiring a path id is omitted
// because it can't be probed without live data.
// ---------------------------------------------------------------------------

const CATALOG: EndpointCatalogEntry[] = [
  // --- Controls: endpoints we already use (should read "available") ---
  { id: 'alert-groups.count', domain: 'detections', path: '/alert-groups/count', scope: 'tenant', integrated: true, description: 'Detection group count (control probe)' },
  { id: 'reports.list', domain: 'reports', path: '/reports', scope: 'tenant', integrated: true, description: 'Report runs (control probe)' },

  // --- Security Posture Rating (SPR) ---
  { id: 'spr.account-all-ratings', domain: 'security-posture', path: '/security-posture/account/all-ratings', scope: 'account', integrated: false, description: 'All tenant SPR scores' },
  { id: 'spr.rating', domain: 'security-posture', path: '/security-posture/rating', scope: 'tenant', integrated: false, description: 'Current tenant SPR score + metric breakdown' },
  { id: 'spr.rating-categories', domain: 'security-posture', path: '/security-posture/rating/categories', scope: 'tenant', integrated: false, description: 'Operational & NIST category breakdown' },
  { id: 'spr.rating-history', domain: 'security-posture', path: '/security-posture/rating/history', scope: 'tenant', integrated: false, description: 'SPR trend (1/6/12 months)' },
  { id: 'spr.attestation-all', domain: 'security-posture', path: '/security-posture/metric-attestation/all', scope: 'tenant', integrated: false, description: 'All metric attestations' },
  { id: 'spr.attestable-metrics', domain: 'security-posture', path: '/security-posture/metric-attestation/attestable-metrics', scope: 'tenant', integrated: false, description: 'Attestable metrics' },

  // --- Vulnerability Management ---
  { id: 'vuln.list', domain: 'vulnerability-management', path: '/vulnerability-management/vulnerabilities', scope: 'tenant', integrated: false, description: 'List vulnerabilities' },
  { id: 'vuln.count-by-severity', domain: 'vulnerability-management', path: '/vulnerability-management/vulnerabilities/stats/count-by-severity', scope: 'tenant', integrated: false, description: 'Vulnerability severity distribution' },
  { id: 'vuln.count-by-tenant', domain: 'vulnerability-management', path: '/vulnerability-management/vulnerabilities/stats/count-by-tenant', scope: 'account', integrated: false, description: 'Per-tenant vulnerability counts' },
  { id: 'vuln.scans', domain: 'vulnerability-management', path: '/vulnerability-management/scans', scope: 'tenant', integrated: false, description: 'List vulnerability scans' },
  { id: 'vuln.scan-schedules', domain: 'vulnerability-management', path: '/vulnerability-management/scan-schedules', scope: 'tenant', integrated: false, description: 'List scan schedules' },
  { id: 'vuln.scans-and-schedules', domain: 'vulnerability-management', path: '/vulnerability-management/scans-and-schedules', scope: 'tenant', integrated: false, description: 'Combined scan inventory' },
  { id: 'vuln.scans-and-schedules-stats', domain: 'vulnerability-management', path: '/vulnerability-management/scans-and-schedules/stats', scope: 'tenant', integrated: false, description: 'Scan statistics' },
  { id: 'vuln.darkweb-exposures', domain: 'vulnerability-management', path: '/vulnerability-management/darkweb/scan/exposures', scope: 'tenant', integrated: false, description: 'Dark web credential exposures' },
  { id: 'vuln.darkweb-report', domain: 'vulnerability-management', path: '/vulnerability-management/darkweb/scan/report', scope: 'tenant', integrated: false, description: 'Dark web scan report' },

  // --- Accounts & Users ---
  { id: 'accounts.list', domain: 'accounts', path: '/accounts', scope: 'account', integrated: false, description: 'List accounts' },
  { id: 'users.list', domain: 'users', path: '/users', scope: 'account', integrated: false, description: 'List users across accounts' },

  // --- Assets (deep) ---
  { id: 'assets.list', domain: 'assets', path: '/assets', scope: 'tenant', integrated: false, description: 'Full asset inventory (search/filter)' },

  // --- Cloud reference / MDR ---
  { id: 'cloud.iso-countries', domain: 'cloud-mdr', path: '/cloud/iso-countries', scope: 'account', integrated: false, description: 'ISO country reference data' },

  // --- Collections & Contact Groups ---
  { id: 'collections.list', domain: 'collections', path: '/collections', scope: 'tenant', integrated: false, description: 'List collections' },
  { id: 'contact-groups.list', domain: 'contact-groups', path: '/contact-groups', scope: 'tenant', integrated: false, description: 'List contact groups' },
];

// ---------------------------------------------------------------------------
// State (in-memory; latest snapshot survives until process restart)
// ---------------------------------------------------------------------------

const client = new CompassOneClient();
let lastRunAt: string | null = null;
let running = false;
let lastResults: EndpointProbeResult[] = [];
/** key -> previous availability, used to detect transitions into "available". */
const previousAvailability = new Map<string, ProbeAvailability>();

function classify(status: number): ProbeAvailability {
  if (status >= 200 && status < 300) return 'available';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 405) return 'available'; // path exists, GET just not allowed
  return 'error';
}

/** Pick the first enabled BP tenant to represent tenant-scoped probes. */
function pickProbeTenant(registry: Map<string, UnifiedTenantConfig>): UnifiedTenantConfig | null {
  for (const t of registry.values()) {
    if (t.enabled && t.blackpoint?.customerId) return t;
  }
  return null;
}

/**
 * Run one discovery pass across the catalog. Account-scoped probes run once;
 * tenant-scoped probes run against a single representative BP tenant to keep
 * the probe volume bounded.
 */
export async function runDiscovery(
  registry: Map<string, UnifiedTenantConfig>,
): Promise<DiscoveryReport> {
  if (running) return getDiscoveryReport();
  running = true;

  const probeTenant = pickProbeTenant(registry);
  const checkedAt = new Date().toISOString();
  const results: EndpointProbeResult[] = [];

  try {
    for (const entry of CATALOG) {
      if (entry.scope === 'tenant' && !probeTenant) continue;

      const { status } = await client.probe({
        path: entry.path,
        scope: entry.scope,
        tenant: entry.scope === 'tenant' ? probeTenant! : undefined,
      });
      const availability = classify(status);
      const prev = previousAvailability.get(entry.id);
      const newlyAvailable = availability === 'available' && prev !== undefined && prev !== 'available';

      if (newlyAvailable && !entry.integrated) {
        logger.info('discovery.endpoint_available', {
          category: 'discovery',
          endpointId: entry.id,
          domain: entry.domain,
          path: entry.path,
          scope: entry.scope,
          previous: prev,
          status,
        });
      }

      previousAvailability.set(entry.id, availability);
      results.push({
        id: entry.id,
        domain: entry.domain,
        path: entry.path,
        scope: entry.scope,
        integrated: entry.integrated,
        description: entry.description,
        availability,
        status,
        tenantAlias: entry.scope === 'tenant' ? probeTenant?.alias : undefined,
        checkedAt,
        newlyAvailable,
      });
    }

    lastResults = results;
    lastRunAt = checkedAt;

    const integratable = results.filter((r) => r.availability === 'available' && !r.integrated);
    logger.info('discovery.run_complete', {
      category: 'discovery',
      totalProbes: results.length,
      available: results.filter((r) => r.availability === 'available').length,
      integratable: integratable.length,
    });
  } finally {
    running = false;
  }

  return getDiscoveryReport();
}

/** Return the latest discovery snapshot without triggering a new run. */
export function getDiscoveryReport(): DiscoveryReport {
  const availableCount = lastResults.filter((r) => r.availability === 'available').length;
  const integratable = lastResults.filter((r) => r.availability === 'available' && !r.integrated);
  return {
    lastRunAt,
    running,
    totalProbes: lastResults.length,
    availableCount,
    integratableCount: integratable.length,
    results: lastResults,
    newlyAvailable: lastResults.filter((r) => r.newlyAvailable),
  };
}

/**
 * Start the periodic discovery scheduler. Gated behind
 * ENABLE_ENDPOINT_DISCOVERY=true. Interval via DISCOVERY_INTERVAL_MS
 * (default 24h). First pass runs shortly after boot.
 */
export function startEndpointDiscoveryScheduler(
  registry: Map<string, UnifiedTenantConfig>,
): void {
  if (process.env.ENABLE_ENDPOINT_DISCOVERY !== 'true') return;

  const intervalMs = Number(process.env.DISCOVERY_INTERVAL_MS) || 24 * 60 * 60 * 1000;

  const run = () => {
    runDiscovery(registry).catch((err) =>
      logger.error('discovery.run_failed', { error: (err as Error).message }),
    );
  };

  setTimeout(run, 20_000);
  setInterval(run, intervalMs);
  logger.info('discovery.scheduler_enabled', {
    intervalHours: Math.round(intervalMs / 3_600_000),
    catalogSize: CATALOG.length,
  });
}
