// ---------------------------------------------------------------------------
// Tests — Tuning Insights
// ---------------------------------------------------------------------------
// Run with: npm test  (Node built-in test runner via tsx)
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispositionFromResolution, computeTuningInsights } from './tuningInsights.js';
import type { CloseoutRecord } from '../types.js';

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

test('dispositionFromResolution maps common resolution strings', () => {
  assert.equal(dispositionFromResolution('true-positive-remediated'), 'true-positive');
  assert.equal(dispositionFromResolution('false-positive'), 'false-positive');
  assert.equal(dispositionFromResolution('benign-positive'), 'benign');
  assert.equal(dispositionFromResolution('duplicate'), 'duplicate');
  assert.equal(dispositionFromResolution('informational'), 'informational');
  assert.equal(dispositionFromResolution('something-else'), 'other');
  assert.equal(dispositionFromResolution(undefined), 'other');
});

test('computeTuningInsights returns zeroed overall for empty input', () => {
  const insights = computeTuningInsights([]);
  assert.equal(insights.totalCloseouts, 0);
  assert.equal(insights.overall.fpRate, 0);
  assert.equal(insights.overall.noiseRate, 0);
  assert.equal(insights.overall.avgMttrHours, null);
  assert.deepEqual(insights.byAlertType, []);
  assert.deepEqual(insights.tuningCandidates, []);
});

test('computeTuningInsights aggregates dispositions and fp/noise rates', () => {
  const closeouts: CloseoutRecord[] = [
    closeout({ resolution: 'false-positive', alertTypes: ['ADMIN_RDP'] }),
    closeout({ resolution: 'false-positive', alertTypes: ['ADMIN_RDP'] }),
    closeout({ resolution: 'benign-positive', alertTypes: ['ADMIN_RDP'] }),
    closeout({ resolution: 'true-positive-remediated', alertTypes: ['ADMIN_RDP'] }),
  ];
  const insights = computeTuningInsights(closeouts, { minSample: 3, noiseRateThreshold: 0.5 });

  assert.equal(insights.totalCloseouts, 4);
  assert.equal(insights.overall.falsePositive, 2);
  assert.equal(insights.overall.benign, 1);
  assert.equal(insights.overall.truePositive, 1);
  assert.equal(insights.overall.fpRate, 0.5); // 2/4
  assert.equal(insights.overall.noiseRate, 0.75); // (2 fp + 1 benign)/4

  const rdp = insights.byAlertType.find((r) => r.alertType === 'ADMIN_RDP');
  assert.ok(rdp);
  assert.equal(rdp.total, 4);
  assert.equal(rdp.noise, 3);
  assert.equal(rdp.isTuningCandidate, true);
  assert.equal(insights.tuningCandidates.length, 1);
});

test('computeTuningInsights respects minSample threshold', () => {
  const closeouts: CloseoutRecord[] = [
    closeout({ resolution: 'false-positive', alertTypes: ['RARE_RULE'] }),
    closeout({ resolution: 'false-positive', alertTypes: ['RARE_RULE'] }),
  ];
  const insights = computeTuningInsights(closeouts, { minSample: 3, noiseRateThreshold: 0.5 });
  const rule = insights.byAlertType.find((r) => r.alertType === 'RARE_RULE');
  assert.ok(rule);
  assert.equal(rule.noiseRate, 1);
  assert.equal(rule.isTuningCandidate, false); // only 2 samples < minSample 3
  assert.equal(insights.tuningCandidates.length, 0);
});

test('computeTuningInsights computes MTTR from detection/closed timestamps', () => {
  const closeouts: CloseoutRecord[] = [
    closeout({
      resolution: 'true-positive-remediated',
      alertTypes: ['SLOW_RULE'],
      detectionCreatedAt: '2026-01-01T00:00:00.000Z',
      closedAt: '2026-01-01T04:00:00.000Z',
    }),
  ];
  const insights = computeTuningInsights(closeouts);
  const rule = insights.byAlertType.find((r) => r.alertType === 'SLOW_RULE');
  assert.ok(rule);
  assert.equal(rule.avgMttrHours, 4);
  assert.equal(insights.overall.avgMttrHours, 4);
});

test('computeTuningInsights buckets records without alertTypes as uncategorized', () => {
  const insights = computeTuningInsights([closeout({ resolution: 'false-positive' })]);
  const uncategorized = insights.byAlertType.find((r) => r.alertType === '(uncategorized)');
  assert.ok(uncategorized);
  assert.equal(uncategorized.total, 1);
});
