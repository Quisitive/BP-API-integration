// ---------------------------------------------------------------------------
// Service — Snapshot Anomaly Detection
// ---------------------------------------------------------------------------
// Turns trend-snapshot history into spike/anomaly alerts. Each metric series
// is compared against a trailing rolling baseline (mean + standard deviation);
// values that jump beyond the configured z-score AND percentage thresholds are
// flagged. Pure function for reuse and testing.
// ---------------------------------------------------------------------------

import type { TrendSnapshot } from '../types.js';

/** Noise dispositions counted toward the false-positive / noise rate. */
const NOISE_DISPOSITIONS = ['false-positive', 'benign', 'informational', 'duplicate'];

export type AnomalySeverity = 'low' | 'medium' | 'high';

export type AnomalyMetric = 'openDetections' | 'totalDetections' | 'noiseRate';

export interface SnapshotAnomaly {
  capturedAt: string;
  metric: AnomalyMetric;
  severity: AnomalySeverity;
  value: number;
  baseline: number;
  /** Fractional change vs baseline mean (0.5 = +50%). */
  deltaPct: number;
  /** How many standard deviations above baseline (Infinity if baseline flat). */
  zScore: number;
  message: string;
}

export interface AnomalyOptions {
  /** Number of trailing snapshots used as the baseline window. */
  window?: number;
  /** Minimum z-score above baseline to flag. */
  zThreshold?: number;
  /** Minimum fractional increase vs baseline mean to flag. */
  minDeltaPct?: number;
  /** Ignore spikes below this absolute value (noise floor). */
  minAbsolute?: number;
}

export interface AnomalyReport {
  generatedAt: string;
  snapshotCount: number;
  anomalies: SnapshotAnomaly[];
  thresholds: Required<AnomalyOptions>;
}

const DEFAULTS: Required<AnomalyOptions> = {
  window: 5,
  zThreshold: 2,
  minDeltaPct: 0.5,
  minAbsolute: 3,
};

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function noiseRate(s: TrendSnapshot): number {
  const counts = s.dispositionCounts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const noise = NOISE_DISPOSITIONS.reduce((sum, d) => sum + (counts[d] || 0), 0);
  return noise / total;
}

function severityFor(zScore: number, deltaPct: number): AnomalySeverity {
  if (zScore >= 4 || deltaPct >= 2) return 'high';
  if (zScore >= 3 || deltaPct >= 1) return 'medium';
  return 'low';
}

/**
 * Scan one numeric metric series for upward spikes against a rolling baseline.
 * `format` renders the metric value for the human-readable message.
 */
function scanSeries(
  series: { capturedAt: string; value: number }[],
  metric: AnomalyMetric,
  opts: Required<AnomalyOptions>,
  format: (v: number) => string,
): SnapshotAnomaly[] {
  const anomalies: SnapshotAnomaly[] = [];

  for (let i = 1; i < series.length; i++) {
    const baselinePoints = series.slice(Math.max(0, i - opts.window), i).map((p) => p.value);
    if (baselinePoints.length === 0) continue;

    const mean = baselinePoints.reduce((a, b) => a + b, 0) / baselinePoints.length;
    const variance =
      baselinePoints.reduce((a, b) => a + (b - mean) ** 2, 0) / baselinePoints.length;
    const stddev = Math.sqrt(variance);

    const current = series[i];
    const value = current.value;
    if (value < opts.minAbsolute || value <= mean) continue;

    const deltaPct = mean > 0 ? (value - mean) / mean : Infinity;
    const zScore = stddev > 0 ? (value - mean) / stddev : Infinity;

    const zOk = zScore >= opts.zThreshold;
    const pctOk = deltaPct >= opts.minDeltaPct;
    if (!zOk || !pctOk) continue;

    const severity = severityFor(zScore, deltaPct);
    const pctLabel = deltaPct === Infinity ? 'new activity' : `+${round(deltaPct * 100, 0)}%`;
    anomalies.push({
      capturedAt: current.capturedAt,
      metric,
      severity,
      value: round(value, 3),
      baseline: round(mean, 3),
      deltaPct: deltaPct === Infinity ? Infinity : round(deltaPct, 3),
      zScore: zScore === Infinity ? Infinity : round(zScore, 2),
      message: `${metric} spiked to ${format(value)} (${pctLabel} vs baseline ${format(mean)})`,
    });
  }

  return anomalies;
}

/**
 * Detect spike anomalies across trend-snapshot history. Analyzes open-detection
 * volume, total-detection volume, and closeout noise rate. Snapshots are sorted
 * chronologically before analysis. Returns anomalies newest-first.
 */
export function detectSnapshotAnomalies(
  snapshots: TrendSnapshot[],
  options: AnomalyOptions = {},
): AnomalyReport {
  const opts: Required<AnomalyOptions> = { ...DEFAULTS, ...options };

  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  const intFmt = (v: number) => String(Math.round(v));
  const pctFmt = (v: number) => `${round(v * 100, 1)}%`;

  const anomalies = [
    ...scanSeries(
      sorted.map((s) => ({ capturedAt: s.capturedAt, value: s.openDetections })),
      'openDetections',
      opts,
      intFmt,
    ),
    ...scanSeries(
      sorted.map((s) => ({ capturedAt: s.capturedAt, value: s.totalDetections })),
      'totalDetections',
      opts,
      intFmt,
    ),
    ...scanSeries(
      sorted.map((s) => ({ capturedAt: s.capturedAt, value: noiseRate(s) })),
      'noiseRate',
      opts,
      pctFmt,
    ),
  ].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

  return {
    generatedAt: new Date().toISOString(),
    snapshotCount: sorted.length,
    anomalies,
    thresholds: opts,
  };
}
