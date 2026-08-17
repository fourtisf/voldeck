/**
 * SIM engine — port of the prototype's season/WALK/SPIKE generator.
 * Instead of mutating in-memory arrays it writes the same VolumeBucket /
 * VenueVolume rows the live ingester writes, so the API and frontend cannot
 * tell the difference (DATA_MODE=sim).
 *
 * Production tiers: fine = 5m buckets, coarse = 15m buckets. The sim writes
 * both tiers from the same increments so rollups are consistent by
 * construction.
 */
import { getPrisma } from '@voldeck/db';
import {
  CHAINS, ORDER, SIM_VENUES, type ChainCode,
  FINE_MS, COARSE_MS, clamp,
} from '@voldeck/shared';
import { log } from './log';

const prisma = getPrisma();

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/* Intraday + weekly seasonality — verbatim from the prototype. */
function season(ts: number): number {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const dow = d.getUTCDay();
  const weekly = 1 + (dow === 0 || dow === 6 ? 0.12 : 0) + 0.06 * Math.sin((dow / 7) * 2 * Math.PI);
  return Math.max(0.25, (1 + 0.32 * Math.sin(((h - 3) / 24) * 2 * Math.PI) + 0.18 * Math.sin(((h - 9) / 12) * 2 * Math.PI)) * weekly);
}

/* Per-chain random-walk + spike state (in-memory; resets on restart, fine for sim). */
const WALK: Record<ChainCode, number> = { SOL: 1, ETH: 1, BSC: 1, RBH: 1 };
const SPIKE: Record<ChainCode, { until: number; mult: number }> = {
  SOL: { until: 0, mult: 1 }, ETH: { until: 0, mult: 1 }, BSC: { until: 0, mult: 1 }, RBH: { until: 0, mult: 1 },
};

export function isSpiking(ch: ChainCode, now = Date.now()): boolean {
  return now < SPIKE[ch].until;
}

const SEED_COARSE_DAYS = 30;
const SEED_FINE_DAYS = 14;
const SEED_VENUE_DAYS = 7;
const TICK_MS = 5_000;

/** Deterministic pseudo-noise in [0,1) from a string key — keeps per-hour venue splits stable across recomputes. */
function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

interface BucketRow { chain: string; tier: string; bucketTs: Date; volumeUsd: number; txns: number }

/** Generate a coarse bucket value from the generator, given walk/trend state. */
function genCoarse(ch: ChainCode, ts: number, w: number, trend: number): number {
  let v = (CHAINS[ch].simBase / 96) * season(ts) * w * trend * rnd(0.75, 1.3);
  if (Math.random() < 0.012) v *= rnd(1.6, 3.2);
  return v;
}

/** Split one coarse bucket into 3 fine buckets with random weights (sums exactly). */
function splitFine(v: number): [number, number, number] {
  const w = [rnd(0.8, 1.25), rnd(0.8, 1.25), rnd(0.8, 1.25)];
  const s = w[0] + w[1] + w[2];
  return [v * (w[0] / s), v * (w[1] / s), v * (w[2] / s)];
}

async function insertBuckets(rows: BucketRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.volumeBucket.createMany({
      data: rows.slice(i, i + 1000),
      skipDuplicates: true,
    });
  }
}

/**
 * Seed history on first run so the deploy is demoable immediately:
 * 30d of coarse, 14d of fine (derived from coarse), 7d of hourly venue rows.
 */
export async function seedIfEmpty(): Promise<void> {
  const existing = await prisma.volumeBucket.count({ where: { tier: 'coarse' } });
  if (existing > 0) {
    log.info('sim seed skipped — data exists', { coarseRows: existing });
    await fillGaps();
    await ensureVenueHistory();
    return;
  }
  const t0 = Date.now();
  const coarseAnchor = Math.floor(Date.now() / COARSE_MS) * COARSE_MS;
  const nCoarse = (SEED_COARSE_DAYS * 24 * 60 * 60 * 1000) / COARSE_MS;
  const fineCutoff = coarseAnchor - SEED_FINE_DAYS * 24 * 60 * 60 * 1000;

  for (const ch of ORDER) {
    const rows: BucketRow[] = [];
    let w = 1, trend = rnd(0.7, 1.1);
    for (let i = 0; i < nCoarse; i++) {
      const ts = coarseAnchor - (nCoarse - 1 - i) * COARSE_MS;
      trend *= 1 + rnd(-0.0022, 0.0028); trend = clamp(trend, 0.45, 2.1);
      w *= 1 + rnd(-0.035, 0.035); w = clamp(w, 0.55, 1.9);
      const v = genCoarse(ch, ts, w, trend);
      rows.push({ chain: ch, tier: 'coarse', bucketTs: new Date(ts), volumeUsd: round2(v), txns: Math.round(v / CHAINS[ch].avgTrade) });
      if (ts >= fineCutoff) {
        const parts = splitFine(v);
        for (let j = 0; j < 3; j++) {
          rows.push({
            chain: ch, tier: 'fine', bucketTs: new Date(ts + j * FINE_MS),
            volumeUsd: round2(parts[j]), txns: Math.round(parts[j] / CHAINS[ch].avgTrade),
          });
        }
      }
    }
    WALK[ch] = w;
    await insertBuckets(rows);
  }

  await ensureVenueHistory();
  log.info('sim seed complete', { ms: Date.now() - t0 });
}

/**
 * Backfill hourly VenueVolume rows for any chain-hour in the venue window
 * that has none, deriving hour volume from coarse buckets. Covers the fresh
 * seed, downtime gaps, and newly added venues going forward.
 */
async function ensureVenueHistory(): Promise<void> {
  const from = Math.floor(Date.now() / 3600_000) * 3600_000 - SEED_VENUE_DAYS * 24 * 3600_000;
  for (const ch of ORDER) {
    const existing = await prisma.venueVolume.findMany({
      where: { chain: ch, ts: { gte: new Date(from) } },
      select: { ts: true },
      distinct: ['ts'],
    });
    const have = new Set(existing.map((r) => r.ts.getTime()));
    const buckets = await prisma.volumeBucket.findMany({
      where: { chain: ch, tier: 'coarse', bucketTs: { gte: new Date(from) } },
      select: { bucketTs: true, volumeUsd: true },
    });
    const byHour = new Map<number, number>();
    for (const b of buckets) {
      const h = Math.floor(b.bucketTs.getTime() / 3600_000) * 3600_000;
      byHour.set(h, (byHour.get(h) ?? 0) + Number(b.volumeUsd));
    }
    const venueRows: { chain: string; venue: string; ts: Date; volumeUsd: number }[] = [];
    for (const [h, hourVol] of byHour) {
      if (have.has(h) || hourVol <= 0) continue;
      venueRows.push(...venueSplit(ch, h, hourVol));
    }
    for (let i = 0; i < venueRows.length; i += 1000) {
      await prisma.venueVolume.createMany({ data: venueRows.slice(i, i + 1000), skipDuplicates: true });
    }
    if (venueRows.length) log.info('venue history backfilled', { chain: ch, rows: venueRows.length });
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Stable venue split for a chain-hour: configured shares ± deterministic noise, renormalized. */
function venueSplit(ch: ChainCode, hourTs: number, hourVol: number) {
  const cfg = SIM_VENUES[ch];
  const noisy = cfg.map(([name, share]) => [name, share * (0.85 + 0.3 * hash01(ch + name + hourTs))] as [string, number]);
  const tot = noisy.reduce((s, [, v]) => s + v, 0);
  return noisy.map(([name, v]) => ({
    chain: ch as string, venue: name, ts: new Date(hourTs), volumeUsd: round2((hourVol * v) / tot),
  }));
}

/** After downtime, fill missing coarse+fine buckets between last stored bucket and now. */
async function fillGaps(): Promise<void> {
  const coarseAnchor = Math.floor(Date.now() / COARSE_MS) * COARSE_MS;
  for (const ch of ORDER) {
    const last = await prisma.volumeBucket.findFirst({
      where: { chain: ch, tier: 'coarse' },
      orderBy: { bucketTs: 'desc' },
      select: { bucketTs: true },
    });
    if (!last) continue;
    const from = last.bucketTs.getTime() + COARSE_MS;
    if (from > coarseAnchor - COARSE_MS) continue;
    const rows: BucketRow[] = [];
    for (let ts = from; ts < coarseAnchor; ts += COARSE_MS) {
      const v = genCoarse(ch, ts, WALK[ch], 1);
      rows.push({ chain: ch, tier: 'coarse', bucketTs: new Date(ts), volumeUsd: round2(v), txns: Math.round(v / CHAINS[ch].avgTrade) });
      const parts = splitFine(v);
      for (let j = 0; j < 3; j++) {
        rows.push({
          chain: ch, tier: 'fine', bucketTs: new Date(ts + j * FINE_MS),
          volumeUsd: round2(parts[j]), txns: Math.round(parts[j] / CHAINS[ch].avgTrade),
        });
      }
    }
    if (rows.length) {
      await insertBuckets(rows);
      log.info('sim gap filled', { chain: ch, buckets: rows.length });
    }
  }
}

let tickCount = 0;

/** One live tick: accumulate volume into the current fine + coarse buckets. */
async function tick(): Promise<void> {
  const now = Date.now();
  const coarseTs = new Date(Math.floor(now / COARSE_MS) * COARSE_MS);
  const fineTs = new Date(Math.floor(now / FINE_MS) * FINE_MS);

  for (const ch of ORDER) {
    WALK[ch] *= 1 + rnd(-0.012, 0.012);
    WALK[ch] = clamp(WALK[ch], 0.55, 1.9);
    const spikeMul = now < SPIKE[ch].until ? SPIKE[ch].mult * rnd(0.85, 1.15) : 1;
    const inc = round2((CHAINS[ch].simBase / 96) * season(now) * WALK[ch] * rnd(0.7, 1.4) * spikeMul * (TICK_MS / COARSE_MS));
    const txInc = Math.max(1, Math.round(inc / CHAINS[ch].avgTrade));
    for (const [tier, bucketTs] of [['coarse', coarseTs], ['fine', fineTs]] as const) {
      await prisma.volumeBucket.upsert({
        where: { chain_tier_bucketTs: { chain: ch, tier, bucketTs } },
        update: { volumeUsd: { increment: inc }, txns: { increment: txInc } },
        create: { chain: ch, tier, bucketTs, volumeUsd: inc, txns: txInc },
      });
    }
  }

  /* occasionally start a surge window long enough for the alert engine to detect (+30% 1h) */
  if (Math.random() < 0.008) {
    const ch = ORDER[Math.floor(Math.random() * ORDER.length)];
    if (now >= SPIKE[ch].until) {
      SPIKE[ch] = { until: now + rnd(10, 25) * 60_000, mult: rnd(1.8, 2.8) };
      log.info('sim spike started', { chain: ch, minutes: Math.round((SPIKE[ch].until - now) / 60_000) });
    }
  }

  /* refresh current-hour venue rows every ~30s */
  if (tickCount % 6 === 0) await updateVenues();
  tickCount++;
}

async function updateVenues(): Promise<void> {
  const hourTs = Math.floor(Date.now() / 3600_000) * 3600_000;
  for (const ch of ORDER) {
    const agg = await prisma.volumeBucket.aggregate({
      where: { chain: ch, tier: 'fine', bucketTs: { gte: new Date(hourTs) } },
      _sum: { volumeUsd: true },
    });
    const hourVol = Number(agg._sum.volumeUsd ?? 0);
    if (hourVol <= 0) continue;
    for (const row of venueSplit(ch, hourTs, hourVol)) {
      await prisma.venueVolume.upsert({
        where: { chain_venue_ts: { chain: row.chain, venue: row.venue, ts: row.ts } },
        update: { volumeUsd: row.volumeUsd },
        create: row,
      });
    }
  }
}

export function startSim(): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (e) {
      log.error('sim tick failed', e);
    } finally {
      running = false;
    }
  }, TICK_MS);
  log.info('sim engine started', { tickMs: TICK_MS });
}
