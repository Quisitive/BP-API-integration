// ---------------------------------------------------------------------------
// Tests — Correlation Trends
// ---------------------------------------------------------------------------
// Run with: npm test  (Node built-in test runner via tsx)
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCorrelationTrends } from './correlationTrends.js';
import type { DetectionCorrelation } from '../types.js';

function corr(partial: Partial<DetectionCorrelation>): DetectionCorrelation {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    tenantAlias: partial.tenantAlias ?? 'acme',
    bpDetectionId: partial.bpDetectionId ?? 'bp-1',
    xdrIncidentId: partial.xdrIncidentId ?? 'xdr-1',
    correlationType: partial.correlationType ?? 'analyst-confirmed',
    confidence: partial.confidence ?? 0.5,
    createdAt: partial.createdAt ?? '2026-01-05T12:00:00.000Z',
  };
}

test('computeCorrelationTrends returns empty shape for no correlations', () => {
  const t = computeCorrelationTrends([]);
  assert.equal(t.totalCorrelations, 0);
  assert.equal(t.distinctBpDetections, 0);
  assert.equal(t.distinctXdrIncidents, 0);
  assert.equal(t.avgConfidence, 0);
  assert.deepEqual(t.byWeek, []);
  assert.deepEqual(t.byType, []);
  assert.ok(t.generatedAt);
});

test('computeCorrelationTrends counts distinct detections/incidents and avg confidence', () => {
  const t = computeCorrelationTrends([
    corr({ bpDetectionId: 'bp-1', xdrIncidentId: 'xdr-1', confidence: 0.9 }),
    corr({ bpDetectionId: 'bp-1', xdrIncidentId: 'xdr-2', confidence: 0.7 }),
    corr({ bpDetectionId: 'bp-2', xdrIncidentId: 'xdr-2', confidence: 0.5 }),
  ]);
  assert.equal(t.totalCorrelations, 3);
  assert.equal(t.distinctBpDetections, 2); // bp-1, bp-2
  assert.equal(t.distinctXdrIncidents, 2); // xdr-1, xdr-2
  assert.equal(t.avgConfidence, 0.7); // (0.9+0.7+0.5)/3
});

test('computeCorrelationTrends buckets by correlation type sorted desc', () => {
  const t = computeCorrelationTrends([
    corr({ correlationType: 'entity' }),
    corr({ correlationType: 'entity' }),
    corr({ correlationType: 'temporal' }),
  ]);
  assert.deepEqual(t.byType, [
    { type: 'entity', count: 2 },
    { type: 'temporal', count: 1 },
  ]);
});

test('computeCorrelationTrends groups by ISO week (Monday start) sorted asc', () => {
  const t = computeCorrelationTrends([
    // 2026-01-05 is a Monday
    corr({ createdAt: '2026-01-07T10:00:00.000Z' }), // week of 2026-01-05
    corr({ createdAt: '2026-01-05T00:00:00.000Z' }), // week of 2026-01-05
    corr({ createdAt: '2026-01-12T09:00:00.000Z' }), // week of 2026-01-12
  ]);
  assert.deepEqual(t.byWeek, [
    { week: '2026-01-05', count: 2 },
    { week: '2026-01-12', count: 1 },
  ]);
});
