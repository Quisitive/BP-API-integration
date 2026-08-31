// ---------------------------------------------------------------------------
// Service — Tuning Insights
// ---------------------------------------------------------------------------
// Turns closeout history into alert-tuning signal: disposition mix, false-
// positive / noise rate per alert type, mean-time-to-resolve, and a ranked
// list of tuning candidates (noisy rules SecOps should tune). Pure functions
// so they can be reused by routes and unit tests.
// ---------------------------------------------------------------------------

import type { CloseoutRecord, Disposition } from '../types.js';

const UNCATEGORIZED = '(uncategorized)';

/** Map a free-form resolution string to a normalized disposition bucket. */
export function dispositionFromResolution(resolution: string | undefined): Disposition {
  const r = (resolution || '').toLowerCase();
  if (r.startsWith('true-positive') || r.startsWith('true_positive')) return 'true-positive';
  if (r.includes('false-positive') || r.includes('false_positive')) return 'false-positive';
  if (r.includes('benign')) return 'benign';
  if (r.includes('duplicate')) return 'duplicate';
  if (r.includes('informational') || r.includes('info-only') || r.includes('informational-only'))
    return 'informational';
  return 'other';
}

/** Resolve a record's disposition, preferring the stored value. */
function resolveDisposition(record: CloseoutRecord): Disposition {
  return record.disposition || dispositionFromResolution(record.resolution);
}

export interface AlertTypeInsight {
  alertType: string;
  total: number;
  truePositive: number;
  falsePositive: number;
  benign: number;
  duplicate: number;
  informational: number;
  other: number;
  /** Non-actionable outcomes: false-positive + benign + informational + duplicate. */
  noise: number;
  /** falsePositive / total. */
  fpRate: number;
  /** noise / total. */
  noiseRate: number;
  /** Mean time to resolve in hours, or null when no MTTR samples exist. */
  avgMttrHours: number | null;
  /** True when this rule meets the tuning-candidate thresholds. */
  isTuningCandidate: boolean;
}

export interface DispositionCount {
  disposition: Disposition;
  count: number;
}

export interface TuningInsights {
  generatedAt: string;
  totalCloseouts: number;
  overall: {
    truePositive: number;
    falsePositive: number;
    benign: number;
    duplicate: number;
    informational: number;
    other: number;
    fpRate: number;
    noiseRate: number;
    avgMttrHours: number | null;
  };
  dispositionSummary: DispositionCount[];
  byAlertType: AlertTypeInsight[];
  tuningCandidates: AlertTypeInsight[];
  mttrByType: { alertType: string; avgMttrHours: number }[];
  thresholds: { minSample: number; noiseRateThreshold: number };
}

export interface TuningInsightsOptions {
  /** Minimum closeouts for an alert type to qualify as a tuning candidate. */
  minSample?: number;
  /** Noise-rate at/above which an alert type is flagged for tuning (0..1). */
  noiseRateThreshold?: number;
}

interface Bucket {
  total: number;
  truePositive: number;
  falsePositive: number;
  benign: number;
  duplicate: number;
  informational: number;
  other: number;
  mttrHours: number[];
}

function newBucket(): Bucket {
  return {
    total: 0,
    truePositive: 0,
    falsePositive: 0,
    benign: 0,
    duplicate: 0,
    informational: 0,
    other: 0,
    mttrHours: [],
  };
}

function tally(bucket: Bucket, disposition: Disposition, mttrHours: number | null): void {
  bucket.total += 1;
  switch (disposition) {
    case 'true-positive': bucket.truePositive += 1; break;
    case 'false-positive': bucket.falsePositive += 1; break;
    case 'benign': bucket.benign += 1; break;
    case 'duplicate': bucket.duplicate += 1; break;
    case 'informational': bucket.informational += 1; break;
    default: bucket.other += 1; break;
  }
  if (mttrHours != null && Number.isFinite(mttrHours) && mttrHours >= 0) {
    bucket.mttrHours.push(mttrHours);
  }
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function mttrForRecord(record: CloseoutRecord): number | null {
  if (!record.detectionCreatedAt || !record.closedAt) return null;
  const start = Date.parse(record.detectionCreatedAt);
  const end = Date.parse(record.closedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / 3_600_000;
}

/** Aggregate closeout records into tuning insights. */
export function computeTuningInsights(
  closeouts: CloseoutRecord[],
  opts: TuningInsightsOptions = {},
): TuningInsights {
  const minSample = opts.minSample ?? 3;
  const noiseRateThreshold = opts.noiseRateThreshold ?? 0.5;

  const overall = newBucket();
  const byType = new Map<string, Bucket>();

  for (const record of closeouts) {
    const disposition = resolveDisposition(record);
    const mttr = mttrForRecord(record);
    tally(overall, disposition, mttr);

    const types = record.alertTypes && record.alertTypes.length > 0
      ? record.alertTypes
      : [UNCATEGORIZED];
    for (const type of types) {
      let bucket = byType.get(type);
      if (!bucket) {
        bucket = newBucket();
        byType.set(type, bucket);
      }
      tally(bucket, disposition, mttr);
    }
  }

  const toInsight = (alertType: string, b: Bucket): AlertTypeInsight => {
    const noise = b.falsePositive + b.benign + b.informational + b.duplicate;
    const fpRate = b.total > 0 ? b.falsePositive / b.total : 0;
    const noiseRate = b.total > 0 ? noise / b.total : 0;
    const avgMttr = avg(b.mttrHours);
    return {
      alertType,
      total: b.total,
      truePositive: b.truePositive,
      falsePositive: b.falsePositive,
      benign: b.benign,
      duplicate: b.duplicate,
      informational: b.informational,
      other: b.other,
      noise,
      fpRate: round(fpRate, 3),
      noiseRate: round(noiseRate, 3),
      avgMttrHours: avgMttr == null ? null : round(avgMttr, 1),
      isTuningCandidate: b.total >= minSample && noiseRate >= noiseRateThreshold,
    };
  };

  const byAlertType = Array.from(byType.entries())
    .map(([type, b]) => toInsight(type, b))
    .sort((a, b) => b.noiseRate - a.noiseRate || b.total - a.total);

  const tuningCandidates = byAlertType
    .filter((t) => t.isTuningCandidate)
    .sort((a, b) => b.noiseRate - a.noiseRate || b.total - a.total);

  const mttrByType = byAlertType
    .filter((t) => t.avgMttrHours != null)
    .map((t) => ({ alertType: t.alertType, avgMttrHours: t.avgMttrHours as number }))
    .sort((a, b) => b.avgMttrHours - a.avgMttrHours);

  const dispositionOrder: Disposition[] = [
    'true-positive', 'false-positive', 'benign', 'duplicate', 'informational', 'other',
  ];
  const overallCounts: Record<Disposition, number> = {
    'true-positive': overall.truePositive,
    'false-positive': overall.falsePositive,
    benign: overall.benign,
    duplicate: overall.duplicate,
    informational: overall.informational,
    other: overall.other,
  };
  const dispositionSummary = dispositionOrder
    .map((d) => ({ disposition: d, count: overallCounts[d] }))
    .filter((d) => d.count > 0);

  const overallNoise = overall.falsePositive + overall.benign + overall.informational + overall.duplicate;
  const overallAvgMttr = avg(overall.mttrHours);

  return {
    generatedAt: new Date().toISOString(),
    totalCloseouts: overall.total,
    overall: {
      truePositive: overall.truePositive,
      falsePositive: overall.falsePositive,
      benign: overall.benign,
      duplicate: overall.duplicate,
      informational: overall.informational,
      other: overall.other,
      fpRate: overall.total > 0 ? round(overall.falsePositive / overall.total, 3) : 0,
      noiseRate: overall.total > 0 ? round(overallNoise / overall.total, 3) : 0,
      avgMttrHours: overallAvgMttr == null ? null : round(overallAvgMttr, 1),
    },
    dispositionSummary,
    byAlertType,
    tuningCandidates,
    mttrByType,
    thresholds: { minSample, noiseRateThreshold },
  };
}
