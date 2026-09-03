// ---------------------------------------------------------------------------
// Tests — File Storage Backend
// ---------------------------------------------------------------------------
// Run with: npm test  (Node built-in test runner via tsx)
// ---------------------------------------------------------------------------

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileCaseRepository } from './file.js';
import type { TrendSnapshot } from '../types.js';

const tmpFiles: string[] = [];

function tmpPath(): string {
  const p = path.join(os.tmpdir(), `bp-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(p);
  return p;
}

function snap(partial: Partial<TrendSnapshot>): TrendSnapshot {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    tenantAlias: partial.tenantAlias ?? 'acme',
    capturedAt: partial.capturedAt ?? '2026-01-01T00:00:00.000Z',
    openDetections: partial.openDetections ?? 0,
    resolvedDetections: partial.resolvedDetections ?? 0,
    totalDetections: partial.totalDetections ?? 0,
    closeoutCount: partial.closeoutCount ?? 0,
    dispositionCounts: partial.dispositionCounts ?? {},
    ...partial,
  };
}

afterEach(async () => {
  await Promise.all(tmpFiles.splice(0).map((f) => fs.rm(f, { force: true })));
});

test('init on a missing file starts empty', async () => {
  const repo = new FileCaseRepository(tmpPath());
  await repo.init();
  assert.deepEqual(await repo.listTrendSnapshots('acme'), []);
});

test('saved trend snapshots survive a new repository instance', async () => {
  const file = tmpPath();
  const repo = new FileCaseRepository(file);
  await repo.init();
  await repo.saveTrendSnapshot(snap({ tenantAlias: 'acme', totalDetections: 42 }));

  const reopened = new FileCaseRepository(file);
  await reopened.init();
  const rows = await reopened.listTrendSnapshots('acme');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalDetections, 42);
});

test('persist writes valid JSON with the serialized state shape', async () => {
  const file = tmpPath();
  const repo = new FileCaseRepository(file);
  await repo.init();
  await repo.saveTrendSnapshot(snap({ tenantAlias: 'acme' }));

  const parsed = JSON.parse(await fs.readFile(file, 'utf-8'));
  assert.ok(Array.isArray(parsed.trendSnapshots));
  assert.equal(parsed.trendSnapshots.length, 1);
  assert.ok(Array.isArray(parsed.cases));
  assert.ok(Array.isArray(parsed.correlations));
});
