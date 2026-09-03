// ---------------------------------------------------------------------------
// Tests — Snapshot Anomaly Detection
// ---------------------------------------------------------------------------
// Run with: npm test  (Node built-in test runner via tsx)
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSnapshotAnomalies } from './snapshotAnomalies.js';
import type { TrendSnapshot } from '../types.js';

let seq = 0;
function snap(partial: Partial<TrendSnapshot>): TrendSnapshot {
  seq += 1;
  return {
    id: partial.id ?? `s-${seq}`,
    tenantAlias: partial.tenantAlias ?? 'acme',
    // Default ascending timestamps one day apart so ordering is deterministic.
    capturedAt: partial.capturedAt ?? `2026-01-${String(seq).padStart(2, '0')}T00:00:00.000Z`,
    openDetections: partial.openDetections ?? 0,
    resolvedDetections: partial.resolvedDetections ?? 0,
    totalDetections: partial.totalDetections ?? 0,
    closeoutCount: partial.closeoutCount ?? 0,
    dispositionCounts: partial.dispositionCounts ?? {},
  };
}

test('detectSnapshotAnomalies returns no anomalies for a flat series', () => {
  const snaps = Array.from({ length: 8 }, () => snap({ openDetections: 10 }));
  const report = detectSnapshotAnomalies(snaps);
  assert.equal(report.anomalies.length, 0);
  assert.equal(report.snapshotCount, 8);
  assert.ok(report.generatedAt);
});

test('detectSnapshotAnomalies flags an open-detection spike', () => {
  const snaps = [
    snap({ capturedAt: '2026-01-01T00:00:00.000Z', openDetections: 10 }),
    snap({ capturedAt: '2026-01-02T00:00:00.000Z', openDetections: 11 }),
    snap({ capturedAt: '2026-01-03T00:00:00.000Z', openDetections: 9 }),
    snap({ capturedAt: '2026-01-04T00:00:00.000Z', openDetections: 10 }),
    snap({ capturedAt: '2026-01-05T00:00:00.000Z', openDetections: 60 }), // spike
  ];
  const report = detectSnapshotAnomalies(snaps);
  const open = report.anomalies.filter((a) => a.metric === 'openDetections');
  assert.equal(open.length, 1);
  assert.equal(open[0].capturedAt, '2026-01-05T00:00:00.000Z');
  assert.equal(open[0].value, 60);
  assert.equal(open[0].severity, 'high');
  assert.ok(open[0].deltaPct >= 0.5);
});

test('detectSnapshotAnomalies ignores spikes below the noise floor (minAbsolute)', () => {
  const snaps = [
    snap({ openDetections: 0 }),
    snap({ openDetections: 0 }),
    snap({ openDetections: 0 }),
    snap({ openDetections: 2 }), // large % jump but tiny absolute
  ];
  const report = detectSnapshotAnomalies(snaps, { minAbsolute: 3 });
  assert.equal(report.anomalies.length, 0);
});

test('detectSnapshotAnomalies flags a noise-rate surge', () => {
  const clean = { 'true-positive': 10 };
  const noisy = { 'true-positive': 10, 'false-positive': 90 };
  const snaps = [
    snap({ capturedAt: '2026-01-01T00:00:00.000Z', dispositionCounts: clean }),
    snap({ capturedAt: '2026-01-02T00:00:00.000Z', dispositionCounts: clean }),
    snap({ capturedAt: '2026-01-03T00:00:00.000Z', dispositionCounts: clean }),
    snap({ capturedAt: '2026-01-04T00:00:00.000Z', dispositionCounts: noisy }),
  ];
  const report = detectSnapshotAnomalies(snaps, { minAbsolute: 0 });
  const noise = report.anomalies.filter((a) => a.metric === 'noiseRate');
  assert.equal(noise.length, 1);
  assert.equal(noise[0].capturedAt, '2026-01-04T00:00:00.000Z');
  assert.ok(noise[0].value > 0.5);
});

test('detectSnapshotAnomalies sorts anomalies newest-first', () => {
  const snaps = [
    snap({ capturedAt: '2026-01-01T00:00:00.000Z', openDetections: 10 }),
    snap({ capturedAt: '2026-01-02T00:00:00.000Z', openDetections: 10 }),
    snap({ capturedAt: '2026-01-03T00:00:00.000Z', openDetections: 80 }),
    snap({ capturedAt: '2026-01-04T00:00:00.000Z', openDetections: 12 }),
    snap({ capturedAt: '2026-01-05T00:00:00.000Z', openDetections: 90 }),
  ];
  const report = detectSnapshotAnomalies(snaps);
  assert.ok(report.anomalies.length >= 2);
  for (let i = 1; i < report.anomalies.length; i++) {
    assert.ok(report.anomalies[i - 1].capturedAt >= report.anomalies[i].capturedAt);
  }
});
