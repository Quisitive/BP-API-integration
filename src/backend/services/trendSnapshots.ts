// ---------------------------------------------------------------------------
// Service — Trend Snapshots
// ---------------------------------------------------------------------------
// Captures point-in-time detection volume + closeout disposition mix and
// persists it, building trend history beyond the Blackpoint 90-day API window.
// An optional scheduler periodically snapshots all BP-enabled tenants.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { CompassOneClient } from './compassOneClient.js';
import { getRepository } from '../storage/factory.js';
import { dispositionFromResolution } from './tuningInsights.js';
import type { UnifiedTenantConfig } from '../config/tenants.schema.js';
import type { Disposition, TrendSnapshot } from '../types.js';

const bpClient = new CompassOneClient();

/** Capture and persist a trend snapshot for one tenant. */
export async function captureTrendSnapshot(tenant: UnifiedTenantConfig): Promise<TrendSnapshot> {
  const repo = getRepository();

  const [open, resolved, total] = await Promise.all([
    bpClient.getDetectionCount(tenant, 'OPEN').catch(() => 0),
    bpClient.getDetectionCount(tenant, 'RESOLVED').catch(() => 0),
    bpClient.getDetectionCount(tenant).catch(() => 0),
  ]);

  const closeouts = await repo.listCloseouts(tenant.alias, 1000);
  const dispositionCounts: Record<string, number> = {};
  for (const c of closeouts) {
    const d: Disposition = c.disposition || dispositionFromResolution(c.resolution);
    dispositionCounts[d] = (dispositionCounts[d] || 0) + 1;
  }

  const snapshot: TrendSnapshot = {
    id: randomUUID(),
    tenantAlias: tenant.alias,
    capturedAt: new Date().toISOString(),
    openDetections: open,
    resolvedDetections: resolved,
    totalDetections: total,
    closeoutCount: closeouts.length,
    dispositionCounts,
  };

  await repo.saveTrendSnapshot(snapshot);
  return snapshot;
}

/**
 * Start a periodic snapshot job for all BP-enabled tenants. Gated behind
 * ENABLE_TREND_SNAPSHOTS=true so dev runs don't call the BP API unprompted.
 * Interval configurable via SNAPSHOT_INTERVAL_MS (default 24h).
 */
export function startSnapshotScheduler(registry: Map<string, UnifiedTenantConfig>): void {
  if (process.env.ENABLE_TREND_SNAPSHOTS !== 'true') return;

  const intervalMs = Number(process.env.SNAPSHOT_INTERVAL_MS) || 24 * 60 * 60 * 1000;

  const run = async () => {
    for (const tenant of registry.values()) {
      if (!tenant.enabled || !tenant.blackpoint) continue;
      try {
        const s = await captureTrendSnapshot(tenant);
        console.log(`[snapshot] ${tenant.alias}: open=${s.openDetections} resolved=${s.resolvedDetections} closeouts=${s.closeoutCount}`);
      } catch (err) {
        console.warn(`[snapshot] failed for ${tenant.alias}:`, (err as Error).message);
      }
    }
  };

  // First run shortly after boot, then on the configured interval.
  setTimeout(() => void run(), 10_000);
  setInterval(() => void run(), intervalMs);
  console.log(`[snapshot] scheduler enabled (every ${Math.round(intervalMs / 3600000)}h)`);
}
