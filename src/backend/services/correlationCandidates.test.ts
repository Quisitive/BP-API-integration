// ---------------------------------------------------------------------------
// Tests — Automated Correlation Detection
// ---------------------------------------------------------------------------
// Run with: npm test  (Node built-in test runner via tsx)
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCorrelationCandidates } from './correlationCandidates.js';
import type { BpDetection, CaseRecord, DetectionCorrelation } from '../types.js';

function det(partial: Partial<BpDetection>): BpDetection {
  return {
    id: partial.id ?? 'bp-1',
    tenantAlias: partial.tenantAlias ?? 'acme',
    groupKey: partial.groupKey ?? 'gk',
    title: partial.title ?? 'Suspicious PowerShell execution on host',
    severity: partial.severity ?? 'High',
    status: partial.status ?? 'OPEN',
    createdAt: partial.createdAt ?? '2026-01-05T12:00:00.000Z',
    alertCount: partial.alertCount ?? 1,
    entities: partial.entities ?? [],
  };
}

function inc(partial: Partial<CaseRecord>): CaseRecord {
  return {
    id: partial.id ?? 'xdr-1',
    tenantAlias: partial.tenantAlias ?? 'acme',
    title: partial.title ?? 'Malware detected on endpoint',
    severity: partial.severity ?? 'High',
    status: partial.status ?? 'Active',
    createdTime: partial.createdTime ?? '2026-01-05T12:10:00.000Z',
    lastUpdateTime: partial.lastUpdateTime ?? '2026-01-05T12:15:00.000Z',
    alertsCount: partial.alertsCount ?? 1,
    workloads: partial.workloads ?? ['DefenderForEndpoint'],
    lastSyncedAt: partial.lastSyncedAt ?? '2026-01-05T12:15:00.000Z',
  };
}

test('detectCorrelationCandidates returns empty for no data', () => {
  assert.deepEqual(detectCorrelationCandidates([], []), []);
});

test('detectCorrelationCandidates links on shared title terms + close timing', () => {
  const detections = [det({ id: 'bp-1', title: 'PowerShell ransomware execution on WKS-01', createdAt: '2026-01-05T12:00:00.000Z' })];
  const incidents = [inc({ id: 'xdr-1', title: 'Ransomware execution PowerShell WKS-01', createdTime: '2026-01-05T12:05:00.000Z' })];
  const out = detectCorrelationCandidates(detections, incidents);
  assert.equal(out.length, 1);
  assert.equal(out[0].bpDetectionId, 'bp-1');
  assert.equal(out[0].xdrIncidentId, 'xdr-1');
  assert.ok(out[0].confidence >= 0.5);
  assert.ok(out[0].reasons.length >= 1);
});

test('detectCorrelationCandidates excludes already-correlated pairs', () => {
  const detections = [det({ id: 'bp-1', title: 'Ransomware execution PowerShell', createdAt: '2026-01-05T12:00:00.000Z' })];
  const incidents = [inc({ id: 'xdr-1', title: 'Ransomware execution PowerShell', createdTime: '2026-01-05T12:01:00.000Z' })];
  const existing: DetectionCorrelation[] = [
    {
      id: 'c-1',
      tenantAlias: 'acme',
      bpDetectionId: 'bp-1',
      xdrIncidentId: 'xdr-1',
      correlationType: 'analyst-confirmed',
      confidence: 1,
      createdAt: '2026-01-05T13:00:00.000Z',
    },
  ];
  const out = detectCorrelationCandidates(detections, incidents, existing);
  assert.equal(out.length, 0);
});

test('detectCorrelationCandidates does not link unrelated, far-apart items', () => {
  const detections = [det({ id: 'bp-1', title: 'Impossible travel sign-in anomaly', createdAt: '2026-01-01T00:00:00.000Z' })];
  const incidents = [inc({ id: 'xdr-1', title: 'Phishing email reported by user', createdTime: '2026-01-20T00:00:00.000Z' })];
  const out = detectCorrelationCandidates(detections, incidents);
  assert.equal(out.length, 0);
});

test('detectCorrelationCandidates awards entity-in-title bonus and sorts by confidence', () => {
  const detections = [
    det({ id: 'bp-hi', title: 'Credential theft mimikatz', entities: ['wks-42'], createdAt: '2026-01-05T12:00:00.000Z' }),
    det({ id: 'bp-lo', title: 'Credential theft', entities: [], createdAt: '2026-01-05T12:55:00.000Z' }),
  ];
  const incidents = [inc({ id: 'xdr-1', title: 'Credential theft mimikatz on wks-42', createdTime: '2026-01-05T12:02:00.000Z' })];
  const out = detectCorrelationCandidates(detections, incidents);
  assert.ok(out.length >= 1);
  assert.equal(out[0].bpDetectionId, 'bp-hi');
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].confidence >= out[i].confidence);
  }
});
