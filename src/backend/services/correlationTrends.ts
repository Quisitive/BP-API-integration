// ---------------------------------------------------------------------------
// Service — Correlation Trends
// ---------------------------------------------------------------------------
// Aggregates cross-source correlation records (Blackpoint detection <-> Defender
// XDR incident links) into trend signal: volume over time, correlation-type mix,
// average confidence, and how many distinct detections/incidents are corroborated
// across both sources. Pure function for reuse and testing.
// ---------------------------------------------------------------------------

import type { DetectionCorrelation } from '../types.js';

function isoWeekStart(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export interface CorrelationTrends {
  generatedAt: string;
  totalCorrelations: number;
  distinctBpDetections: number;
  distinctXdrIncidents: number;
  avgConfidence: number;
  byWeek: { week: string; count: number }[];
  byType: { type: string; count: number }[];
}

export function computeCorrelationTrends(correlations: DetectionCorrelation[]): CorrelationTrends {
  const weekMap = new Map<string, number>();
  const typeMap = new Map<string, number>();
  const bpIds = new Set<string>();
  const xdrIds = new Set<string>();
  let confidenceSum = 0;

  for (const c of correlations) {
    const week = isoWeekStart(c.createdAt);
    weekMap.set(week, (weekMap.get(week) || 0) + 1);
    const type = c.correlationType || 'unknown';
    typeMap.set(type, (typeMap.get(type) || 0) + 1);
    if (c.bpDetectionId) bpIds.add(c.bpDetectionId);
    if (c.xdrIncidentId) xdrIds.add(c.xdrIncidentId);
    confidenceSum += typeof c.confidence === 'number' ? c.confidence : 0;
  }

  const byWeek = Array.from(weekMap.entries())
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));

  const byType = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    totalCorrelations: correlations.length,
    distinctBpDetections: bpIds.size,
    distinctXdrIncidents: xdrIds.size,
    avgConfidence: correlations.length > 0 ? round(confidenceSum / correlations.length, 2) : 0,
    byWeek,
    byType,
  };
}
