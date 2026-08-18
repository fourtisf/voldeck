/**
 * Window-arithmetic tests — run with: pnpm --filter @voldeck/api test
 *
 * Regression guard for the bug where Vol 1H exceeded Vol 24H because the
 * windows were read from different tiers (24h from the lagging coarse
 * rollup, 1h/6h from fresh fine buckets).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumTail, aggregateSlots } from './data';

const SLOTS_1H = 12, SLOTS_6H = 72, SLOTS_24H = 288, SLOTS_48H = 576;

/** 48h of 5m slots with a plausible volume in each. */
function slots(fill: (i: number) => number | null = (i) => 1000 + i): (number | null)[] {
  return Array.from({ length: SLOTS_48H }, (_, i) => fill(i));
}

test('shorter windows can never exceed longer ones', () => {
  for (const shape of [
    (i: number) => 1000 + i,                       // rising
    (i: number) => 5000 - i,                       // falling
    (i: number) => (i % 7 === 0 ? 90_000 : 800),   // spiky
    (i: number) => (i > SLOTS_48H - 4 ? 1e6 : 10), // fresh spike at the end
  ]) {
    const f = slots(shape);
    const v1 = sumTail(f, SLOTS_1H);
    const v6 = sumTail(f, SLOTS_6H);
    const v24 = sumTail(f, SLOTS_24H);
    assert.ok(v1 <= v6, `1H ${v1} > 6H ${v6}`);
    assert.ok(v6 <= v24, `6H ${v6} > 24H ${v24}`);
  }
});

test('a half-filled history still keeps windows nested', () => {
  // only the most recent 20 slots have data — the case right after a wipe,
  // which is exactly when the mixed-tier bug showed up
  const f = slots((i) => (i >= SLOTS_48H - 20 ? 500 : null));
  assert.ok(sumTail(f, SLOTS_1H) <= sumTail(f, SLOTS_6H));
  assert.ok(sumTail(f, SLOTS_6H) <= sumTail(f, SLOTS_24H));
  assert.equal(sumTail(f, SLOTS_24H), 20 * 500);
});

test('the previous window is disjoint from the current one', () => {
  const f = slots(() => 100);
  assert.equal(sumTail(f, SLOTS_24H), SLOTS_24H * 100);
  assert.equal(sumTail(f, SLOTS_24H, SLOTS_24H), SLOTS_24H * 100);
  // together they must cover 48h exactly, never overlapping
  assert.equal(sumTail(f, SLOTS_24H) + sumTail(f, SLOTS_24H, SLOTS_24H), SLOTS_48H * 100);
});

test('aggregation preserves the total and keeps gaps as gaps', () => {
  const f: (number | null)[] = [10, 20, 30, null, null, null, 5, null, 5];
  const agg = aggregateSlots(f, 3);
  assert.deepEqual(agg, [60, null, 10]);
  const total = agg.reduce((s: number, v) => s + (v ?? 0), 0);
  assert.equal(total, 70, 'aggregation must not invent or lose volume');
});

test('missing buckets read as gaps, never as zero volume', () => {
  const f: (number | null)[] = new Array(SLOTS_48H).fill(null);
  assert.equal(sumTail(f, SLOTS_24H), 0);
  assert.equal(aggregateSlots(f, 3).every((v) => v === null), true);
});
