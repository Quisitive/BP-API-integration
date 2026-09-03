// ---------------------------------------------------------------------------
// Tests — CISO Executive Report
// ---------------------------------------------------------------------------
// Run with: npm test  (Node built-in test runner via tsx)
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCisoReport, renderCisoReportMarkdown, type CisoReportInput } from './cisoReport.js';
import { computeTuningInsights } from './tuningInsights.js';
import { computeCorrelationTrends } from './correlationTrends.js';
import { detectSnapshotAnomalies } from './snapshotAnomalies.js';
import type { CloseoutRecord, TrendSnapshot, DetectionCorrelation } from '../types.js';

function closeout(partial: Partial<CloseoutRecord>): CloseoutRecord {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    tenantAlias: partial.tenantAlias ?? 'acme',
    closedBy: partial.closedBy ?? 'analyst',
    closedAt: partial.closedAt ?? '2026-01-01T02:00:00.000Z',
    resolution: partial.resolution ?? 'true-positive-remediated',
    ...partial,
  };
}

let seq = 0;
function snap(partial: Partial<TrendSnapshot>): TrendSnapshot {
  seq += 1;
  return {
    id: partial.id ?? `s${seq}`,
    tenantAlias: partial.tenantAlias ?? 'acme',
    capturedAt: partial.capturedAt ?? new Date(Date.UTC(2026, 0, seq)).toISOString(),
    openDetections: partial.openDetections ?? 0,
    resolvedDetections: partial.resolvedDetections ?? 0,
    totalDetections: partial.totalDetections ?? 0,
    closeoutCount: partial.closeoutCount ?? 0,
    dispositionCounts: partial.dispositionCounts ?? {},
    ...partial,
  };
}

function corr(partial: Partial<DetectionCorrelation>): DetectionCorrelation {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    tenantAlias: partial.tenantAlias ?? 'acme',
    bpDetectionId: partial.bpDetectionId ?? 'bp-1',
    xdrIncidentId: partial.xdrIncidentId ?? 'xdr-1',
    correlationType: partial.correlationType ?? 'entity',
    confidence: partial.confidence ?? 0.9,
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function buildInput(): CisoReportInput {
  const closeouts: CloseoutRecord[] = [];
  for (let i = 0; i < 8; i++) closeouts.push(closeout({ resolution: 'false-positive', alertTypes: ['ADMIN_RDP'] }));
  for (let i = 0; i < 2; i++) closeouts.push(closeout({ resolution: 'true-positive-remediated', alertTypes: ['ADMIN_RDP'] }));

  return {
    tenantAlias: 'acme',
    tenantName: 'Acme Corp',
    insights: computeTuningInsights(closeouts, { minSample: 3, noiseRateThreshold: 0.5 }),
    trends: computeCorrelationTrends([corr({ confidence: 0.8 }), corr({ confidence: 1.0 })]),
    snapshots: [snap({ totalDetections: 100, openDetections: 40 }), snap({ totalDetections: 150, openDetections: 60 })],
    anomalies: detectSnapshotAnomalies([]),
  };
}

test('buildCisoReport summarizes KPIs from gathered signal', () => {
  const report = buildCisoReport(buildInput());
  assert.equal(report.tenantName, 'Acme Corp');
  assert.equal(report.kpis.totalCloseouts, 10);
  assert.equal(report.kpis.falsePositiveRate, 0.8); // 8/10
  assert.equal(report.kpis.totalCorrelations, 2);
  assert.equal(report.kpis.openDetections, 60); // latest snapshot
  assert.equal(report.kpis.detectionTrendPct, 0.5); // 100 -> 150
});

test('buildCisoReport flags the noisiest rule and recommends tuning', () => {
  const report = buildCisoReport(buildInput());
  assert.equal(report.topNoisyRules[0].alertType, 'ADMIN_RDP');
  assert.ok(report.recommendations.some((r) => /ADMIN_RDP/.test(r)));
});

test('buildCisoReport gives a stable recommendation when signal is clean', () => {
  const input = buildInput();
  input.insights = computeTuningInsights([]);
  input.snapshots = [];
  const report = buildCisoReport(input);
  assert.equal(report.topNoisyRules.length, 0);
  assert.equal(report.recommendations.length, 1);
  assert.match(report.recommendations[0], /within expected thresholds/);
});

test('renderCisoReportMarkdown produces a titled markdown document', () => {
  const md = renderCisoReportMarkdown(buildCisoReport(buildInput()));
  assert.match(md, /^# CISO Security Report — Acme Corp/);
  assert.match(md, /## Key Performance Indicators/);
  assert.match(md, /## Recommendations/);
  assert.match(md, /\| False-positive rate \| 80% \|/);
});
