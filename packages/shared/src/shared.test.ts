/** Core rules that the UI and ingest both depend on. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANGES, RANGE_KEYS, rangeBucketMs, FINE_MS, COARSE_MS } from './ranges';
import { isDenylisted } from './denylist';
import { classifyVenue } from './venues';
import { fmtUsd, fmtPct, niceCeil } from './format';
import { ORDER, CHAINS } from './chains';

test('every range maps to a whole number of source buckets', () => {
  for (const k of RANGE_KEYS) {
    const R = RANGES[k];
    assert.ok(R.n > 0 && R.agg > 0, `${k} has a bad shape`);
    const src = R.src === 'fine' ? FINE_MS : COARSE_MS;
    assert.equal(rangeBucketMs(k), src * R.agg);
  }
});

test('range windows cover the duration their label promises', () => {
  const hours = (k: (typeof RANGE_KEYS)[number]) => (rangeBucketMs(k) * RANGES[k].n) / 3600_000;
  assert.equal(hours('1h'), 1);
  assert.equal(hours('4h'), 4);
  assert.equal(hours('12h'), 12);
  assert.equal(hours('24h'), 24);
  assert.equal(hours('7d'), 168);
});

test('denylist drops majors and stables but keeps memecoins', () => {
  for (const s of ['WETH', 'usdc', 'SOL', 'WBNB', 'stETH']) {
    assert.ok(isDenylisted(s), `${s} should be denylisted`);
  }
  for (const s of ['PEPE', 'BONK', 'WIF', 'CRTX']) {
    assert.ok(!isDenylisted(s), `${s} should NOT be denylisted`);
  }
});

test('launchpads are told apart from plain DEXes', () => {
  for (const v of ['Pump.fun / PumpSwap', 'LetsBonk', 'Four.meme', 'Robinfun', 'Moonshot']) {
    assert.equal(classifyVenue(v), 'launchpad', v);
  }
  for (const v of ['Raydium', 'Uniswap', 'PancakeSwap', 'Meteora']) {
    assert.equal(classifyVenue(v), 'dex', v);
  }
});

test('formatters match the terminal style', () => {
  assert.equal(fmtUsd(1_234_000_000), '$1.23B');
  assert.equal(fmtUsd(2_500_000), '$2.5M');
  assert.equal(fmtUsd(9_400), '$9K');
  assert.equal(fmtPct(4.21), '+4.2%');
  assert.equal(fmtPct(-4.21), '-4.2%');
  assert.ok(niceCeil(0) > 0, 'niceCeil must never return 0 (division by zero in charts)');
});

test('every chain has a colour and a display name', () => {
  for (const c of ORDER) {
    assert.match(CHAINS[c].color, /^#[0-9a-f]{6}$/i);
    assert.ok(CHAINS[c].name.length > 0);
  }
});
