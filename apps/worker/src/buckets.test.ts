/**
 * Bucket-assignment tests — run with: pnpm --filter @voldeck/worker test
 *
 * Regression guard for the bug where a tick's m5 window was written to the
 * wrong 5-minute bucket, so consecutive ticks overwrote each other and
 * volume silently vanished from the series.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINE_MS } from '@voldeck/shared';
import { currentFineBucketTs } from './ingestCommon';

const at = (hhmmss: string) => new Date(`2026-08-18T${hhmmss}Z`).getTime();
const hm = (d: Date) => d.toISOString().slice(11, 16);

test('a tick maps to the bucket its m5 window mostly covers', () => {
  assert.equal(hm(currentFineBucketTs(at('04:56:30'))), '04:50'); // covers 04:51-04:56
  assert.equal(hm(currentFineBucketTs(at('04:59:25'))), '04:55'); // covers 04:54-04:59
  assert.equal(hm(currentFineBucketTs(at('05:04:40'))), '05:00'); // covers 04:59-05:04
});

test('a tick exactly on a boundary takes the just-completed bucket', () => {
  assert.equal(hm(currentFineBucketTs(at('05:00:00'))), '04:55');
  assert.equal(hm(currentFineBucketTs(at('05:05:00'))), '05:00');
});

test('ticks 5 minutes apart never collide or skip, even with drift', () => {
  const seen: number[] = [];
  for (let i = 0; i < 48; i++) {
    // realistic jitter: ingest latency shifts each tick by 0-80s
    const now = at('05:00:00') + i * FINE_MS + (i % 5) * 20_000;
    seen.push(currentFineBucketTs(now).getTime());
  }
  for (let i = 1; i < seen.length; i++) {
    assert.notEqual(seen[i], seen[i - 1], `tick ${i} overwrote the previous bucket`);
    assert.equal(seen[i] - seen[i - 1], FINE_MS, `tick ${i} skipped a bucket`);
  }
});

test('buckets are aligned to the 5-minute grid', () => {
  for (const s of ['04:51:03', '04:57:59', '05:02:30', '05:09:11']) {
    assert.equal(currentFineBucketTs(at(s)).getTime() % FINE_MS, 0);
  }
});
