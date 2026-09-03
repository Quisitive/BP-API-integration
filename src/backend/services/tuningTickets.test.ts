// ---------------------------------------------------------------------------
// Tests — Tuning Tickets
// ---------------------------------------------------------------------------
// Run with: npm test  (Node built-in test runner via tsx)
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTuningTickets, ticketsToCsv } from './tuningTickets.js';
import { computeTuningInsights } from './tuningInsights.js';
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

/** Build insights whose ADMIN_RDP rule is a noisy tuning candidate. */
function noisyInsights() {
  const closeouts: CloseoutRecord[] = [];
  for (let i = 0; i < 25; i++) closeouts.push(closeout({ resolution: 'false-positive', alertTypes: ['ADMIN_RDP'] }));
  for (let i = 0; i < 5; i++) closeouts.push(closeout({ resolution: 'true-positive-remediated', alertTypes: ['ADMIN_RDP'] }));
  return computeTuningInsights(closeouts, { minSample: 3, noiseRateThreshold: 0.5 });
}

test('buildTuningTickets returns [] when there are no candidates', () => {
  const insights = computeTuningInsights([]);
  assert.deepEqual(buildTuningTickets(insights), []);
});

test('buildTuningTickets creates a ticket per tuning candidate', () => {
  const tickets = buildTuningTickets(noisyInsights());
  assert.equal(tickets.length, 1);
  const t = tickets[0];
  assert.equal(t.alertType, 'ADMIN_RDP');
  assert.match(t.title, /ADMIN_RDP/);
  assert.equal(t.evidence.total, 30);
  assert.equal(t.evidence.falsePositive, 25);
  assert.ok(t.labels.includes('tuning'));
});

test('high noise + high volume escalates to P1', () => {
  const tickets = buildTuningTickets(noisyInsights());
  // 25/30 = ~83% noise -> P1
  assert.equal(tickets[0].priority, 'P1');
  assert.ok(tickets[0].labels.includes('priority:p1'));
});

test('tickets are sorted by noise rate descending', () => {
  const closeouts: CloseoutRecord[] = [];
  // NOISY: 9/10 noise
  for (let i = 0; i < 9; i++) closeouts.push(closeout({ resolution: 'false-positive', alertTypes: ['NOISY'] }));
  closeouts.push(closeout({ resolution: 'true-positive-remediated', alertTypes: ['NOISY'] }));
  // MILD: 6/10 noise
  for (let i = 0; i < 6; i++) closeouts.push(closeout({ resolution: 'benign-positive', alertTypes: ['MILD'] }));
  for (let i = 0; i < 4; i++) closeouts.push(closeout({ resolution: 'true-positive-remediated', alertTypes: ['MILD'] }));

  const tickets = buildTuningTickets(computeTuningInsights(closeouts, { minSample: 3, noiseRateThreshold: 0.5 }));
  assert.equal(tickets.length, 2);
  assert.equal(tickets[0].alertType, 'NOISY');
  assert.equal(tickets[1].alertType, 'MILD');
});

test('ticketsToCsv emits a header plus one row per ticket', () => {
  const tickets = buildTuningTickets(noisyInsights());
  const csv = ticketsToCsv(tickets);
  const lines = csv.split('\n');
  assert.equal(lines.length, tickets.length + 1);
  assert.match(lines[0], /^alertType,priority,title,summary,recommendation/);
  assert.match(lines[1], /^ADMIN_RDP,P1,/);
});

test('ticketsToCsv quotes fields that contain commas', () => {
  const ticket = {
    alertType: 'A,B',
    title: 't',
    priority: 'P3' as const,
    summary: 's',
    recommendation: 'r',
    evidence: { total: 1, falsePositive: 0, noise: 0, fpRate: 0, noiseRate: 0, avgMttrHours: null },
    labels: ['tuning'],
  };
  const csv = ticketsToCsv([ticket]);
  assert.match(csv.split('\n')[1], /^"A,B",/);
});
