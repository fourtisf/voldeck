/**
 * Query + payload assembly for all API endpoints. Volume series are read as
 * slot arrays (oldest → newest, ending at the current in-progress bucket) with
 * null marking missing buckets — the frontend renders those as gaps, not
 * zeros. Aggregation to chart points happens here, server-side, per the
 * range→tier table in the handoff.
 */
import { getPrisma } from '@voldeck/db';
import {
  CHAINS, ORDER, RANGES, type ChainCode, type RangeKey, type Tier,
  FINE_MS, COARSE_MS, tierMs, tierAnchor, classifyVenue, isChainCode,
  type OverviewPayload, type OverviewChainRow, type SeriesPayload,
  type ChainDetailPayload, type AlertRow, type AlertType, type VenueRow,
  type LaunchpadsPayload, type LaunchpadRow,
  type LaunchpadSeriesPayload, type LaunchpadSeriesVenue, type LpRangeKey,
  type LaunchpadTokensPayload, type TokenCategory,
} from '@voldeck/shared';
import { getRedis } from './cache';
import { DATA_MODE } from './env';

const prisma = getPrisma();

/* ---------- slot series ---------- */

/**
 * Read `slots` buckets of a tier ending at `anchor` (inclusive) as an array
 * oldest-first; missing buckets are null.
 */
async function fetchSlots(
  chains: ChainCode[], tier: Tier, slots: number, anchor: number
): Promise<Record<ChainCode, (number | null)[]>> {
  const ms = tierMs(tier);
  const start = anchor - (slots - 1) * ms;
  const rows = await prisma.volumeBucket.findMany({
    where: { chain: { in: chains }, tier, bucketTs: { gte: new Date(start), lte: new Date(anchor) } },
    select: { chain: true, bucketTs: true, volumeUsd: true },
  });
  const out = {} as Record<ChainCode, (number | null)[]>;
  for (const ch of chains) out[ch] = new Array(slots).fill(null);
  for (const r of rows) {
    const idx = Math.round((r.bucketTs.getTime() - start) / ms);
    if (idx >= 0 && idx < slots) out[r.chain as ChainCode][idx] = Number(r.volumeUsd);
  }
  return out;
}

/** Sum `agg` consecutive slots per chart point; a point is null only if every member is missing. */
function aggregateSlots(arr: (number | null)[], agg: number): (number | null)[] {
  if (agg === 1) return arr;
  const n = Math.floor(arr.length / agg);
  const out: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, seen = false;
    for (let j = 0; j < agg; j++) {
      const v = arr[i * agg + j];
      if (v !== null) { s += v; seen = true; }
    }
    out[i] = seen ? s : null;
  }
  return out;
}

/** Sum of the trailing `len` slots at `offsetFromEnd` (0 = window ending at anchor). Nulls count as 0. */
function sumTail(arr: (number | null)[], len: number, offsetFromEnd = 0): number {
  let s = 0;
  const end = arr.length - offsetFromEnd;
  for (let i = Math.max(0, end - len); i < end; i++) s += arr[i] ?? 0;
  return s;
}

function hasData(arr: (number | null)[], len: number, offsetFromEnd = 0): boolean {
  const end = arr.length - offsetFromEnd;
  for (let i = Math.max(0, end - len); i < end; i++) if (arr[i] !== null) return true;
  return false;
}

/* ---------- chain metrics (shared by overview + detail) ---------- */

interface ChainMetrics {
  v5: number; v1: number; v6: number; v24: number; p24: number;
  d1: number; d6: number; d24: number;
  share: number; sharePrev: number; rot: number;
  tx: number;
  coarse48h: (number | null)[];
}

async function txns24(ch: ChainCode, v24: number): Promise<number> {
  try {
    const cached = await getRedis().get(`voldeck:txns24:${ch}`);
    if (cached) return Number(cached);
  } catch { /* fall through */ }
  return v24 / CHAINS[ch].avgTrade;
}

async function computeMetrics(): Promise<{ M: Record<ChainCode, ChainMetrics>; T: { v1: number; v6: number; v24: number; p24: number; d24: number; tx: number } }> {
  const coarseAnchor = tierAnchor('coarse');
  const fineAnchor = tierAnchor('fine');
  const coarse = await fetchSlots(ORDER, 'coarse', 192, coarseAnchor); // 48h
  const fine = await fetchSlots(ORDER, 'fine', 144, fineAnchor);       // 12h

  const M = {} as Record<ChainCode, ChainMetrics>;
  const T = { v1: 0, v6: 0, v24: 0, p24: 0, d24: 0, tx: 0 };
  for (const ch of ORDER) {
    const c = coarse[ch], f = fine[ch];
    const v24 = sumTail(c, 96), p24 = sumTail(c, 96, 96);
    const v6 = sumTail(f, 72), p6 = sumTail(f, 72, 72);
    const v1 = sumTail(f, 12), p1 = sumTail(f, 12, 12);
    // last completed fine bucket (the anchor bucket is still accumulating)
    const v5 = f[f.length - 2] ?? f[f.length - 1] ?? 0;
    const tx = await txns24(ch, v24);
    M[ch] = {
      v5, v1, v6, v24, p24,
      d1: p1 > 0 ? ((v1 - p1) / p1) * 100 : 0,
      d6: p6 > 0 ? ((v6 - p6) / p6) * 100 : 0,
      d24: p24 > 0 ? ((v24 - p24) / p24) * 100 : 0,
      share: 0, sharePrev: 0, rot: 0, tx,
      coarse48h: c,
    };
    T.v1 += v1; T.v6 += v6; T.v24 += v24; T.p24 += p24; T.tx += tx;
  }
  for (const ch of ORDER) {
    M[ch].share = T.v24 > 0 ? (M[ch].v24 / T.v24) * 100 : 0;
    M[ch].sharePrev = T.p24 > 0 ? (M[ch].p24 / T.p24) * 100 : M[ch].share;
    M[ch].rot = M[ch].share - M[ch].sharePrev;
  }
  T.d24 = T.p24 > 0 ? ((T.v24 - T.p24) / T.p24) * 100 : 0;
  return { M, T };
}

/** Chains with a surge alert in the last 30 minutes (drives the SURGE pill). */
async function surgingSet(): Promise<Set<ChainCode>> {
  const rows = await prisma.alert.findMany({
    where: { type: 'surge', ts: { gte: new Date(Date.now() - 30 * 60_000) } },
    select: { chain: true },
    distinct: ['chain'],
  });
  return new Set(rows.map((r) => r.chain as ChainCode));
}

/* ---------- endpoints ---------- */

export async function buildOverview(): Promise<OverviewPayload> {
  const { M, T } = await computeMetrics();
  const surging = await surgingSet();
  const coarseAnchor = tierAnchor('coarse');

  const chains: OverviewChainRow[] = ORDER.map((ch) => ({
    chain: ch,
    d1: M[ch].d1, d6: M[ch].d6, d24: M[ch].d24,
    vol1h: M[ch].v1, vol24: M[ch].v24,
    share: M[ch].share, txns: M[ch].tx,
    surging: surging.has(ch),
    spark: M[ch].coarse48h.slice(96),
  }));

  const leader = ORDER.reduce((a, b) => (M[a].share >= M[b].share ? a : b));
  return {
    stats: {
      vol24: T.v24, d24: T.d24, vol1h: T.v1, vol6h: T.v6,
      txns24: T.tx,
      pairs: ORDER.reduce((s, c) => s + CHAINS[c].pairs, 0),
      leader: { chain: leader, share: M[leader].share },
    },
    chains,
    dominance: [...ORDER]
      .sort((a, b) => M[b].share - M[a].share)
      .map((ch) => ({ chain: ch, share: M[ch].share, vol24: M[ch].v24 })),
    rotation: [...ORDER]
      .sort((a, b) => M[b].rot - M[a].rot)
      .map((ch) => ({ chain: ch, share: M[ch].share, sharePrev: M[ch].sharePrev, rot: M[ch].rot })),
    anchorTs: coarseAnchor,
    bucketMs: COARSE_MS,
    mode: DATA_MODE,
  };
}

export async function buildSeries(range: RangeKey, chains: ChainCode[]): Promise<SeriesPayload> {
  const R = RANGES[range];
  const srcMs = tierMs(R.src);
  const anchor = tierAnchor(R.src);
  const slots = R.n * R.agg;

  const raw = await fetchSlots(chains, R.src, slots, anchor);
  const series: SeriesPayload['series'] = {};
  for (const ch of chains) series[ch] = aggregateSlots(raw[ch], R.agg);

  // Δ vs previous window for the bubble view. 1M matches the prototype: no
  // delta (the comparison window would exceed sensible history).
  const deltas: SeriesPayload['deltas'] = {};
  if (range === '1m') {
    for (const ch of chains) deltas[ch] = null;
  } else {
    const wide = await fetchSlots(chains, R.src, slots * 2, anchor);
    for (const ch of chains) {
      const cur = sumTail(wide[ch], slots);
      const prev = sumTail(wide[ch], slots, slots);
      deltas[ch] = hasData(wide[ch], slots, slots) && prev > 0 ? ((cur - prev) / prev) * 100 : null;
    }
  }

  return {
    range,
    bucketMs: srcMs * R.agg,
    anchorTs: anchor - (R.agg - 1) * srcMs,
    series,
    deltas,
  };
}

export async function buildChainDetail(code: ChainCode): Promise<ChainDetailPayload> {
  const { M } = await computeMetrics();
  const m = M[code];
  const surging = await surgingSet();
  const coarseAnchor = tierAnchor('coarse');

  /* hourly heat: 24 groups of 4 coarse slots over the last 24h (prototype's hourlyAgg) */
  const spark = m.coarse48h.slice(96); // 96 slots, ends at anchor
  const heat: number[] = [];
  for (let i = 0; i < 24; i++) {
    heat.push((spark[i * 4] ?? 0) + (spark[i * 4 + 1] ?? 0) + (spark[i * 4 + 2] ?? 0) + (spark[i * 4 + 3] ?? 0));
  }
  const heatAnchorTs = coarseAnchor - 95 * COARSE_MS;
  let pk = 0;
  for (let i = 1; i < 24; i++) if (heat[i] > heat[pk]) pk = i;
  const peakTs = new Date(heatAnchorTs + pk * 4 * COARSE_MS);

  /* venues: last 24h of VenueVolume */
  const venueRows = await prisma.venueVolume.groupBy({
    by: ['venue'],
    where: { chain: code, ts: { gte: new Date(Date.now() - 24 * 3600_000) } },
    _sum: { volumeUsd: true },
  });
  const venueTotal = venueRows.reduce((s, v) => s + Number(v._sum.volumeUsd ?? 0), 0);
  const venues: VenueRow[] = venueRows
    .map((v) => ({
      name: v.venue,
      volumeUsd: Number(v._sum.volumeUsd ?? 0),
      share: venueTotal > 0 ? Number(v._sum.volumeUsd ?? 0) / venueTotal : 0,
    }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
    .slice(0, 8);

  const rank = [...ORDER].sort((a, b) => M[b].v24 - M[a].v24).indexOf(code) + 1;

  return {
    chain: code,
    rank,
    stats: {
      vol5m: m.v5, vol1h: m.v1, vol6h: m.v6, vol24: m.v24,
      d1: m.d1, d6: m.d6, d24: m.d24,
      txns24: m.tx,
      peakHourUtc: peakTs.getUTCHours(),
      peakHourVol: heat[pk],
      avgTrade: CHAINS[code].avgTrade,
      pairs: CHAINS[code].pairs,
      share: m.share, sharePrev: m.sharePrev, rot: m.rot,
    },
    venues,
    heat,
    heatAnchorTs,
    surging: surging.has(code),
    mode: DATA_MODE,
  };
}

/**
 * Cross-chain venue leaderboard: every venue on every chain, last 24h,
 * classified launchpad vs DEX, sorted by volume desc. "Which launchpad has
 * the most memecoin volume" — across all chains, not per chain.
 */
export async function buildLaunchpads(): Promise<LaunchpadsPayload> {
  const grouped = await prisma.venueVolume.groupBy({
    by: ['chain', 'venue'],
    where: { ts: { gte: new Date(Date.now() - 24 * 3600_000) } },
    _sum: { volumeUsd: true },
  });
  const rows: LaunchpadRow[] = grouped
    .filter((g) => isChainCode(g.chain))
    .map((g) => ({
      venue: g.venue,
      chain: g.chain as ChainCode,
      kind: classifyVenue(g.venue),
      volumeUsd: Number(g._sum.volumeUsd ?? 0),
    }))
    .filter((r) => r.volumeUsd > 0)
    .sort((a, b) => b.volumeUsd - a.volumeUsd);
  return {
    rows,
    totalUsd: rows.reduce((s, r) => s + r.volumeUsd, 0),
    mode: DATA_MODE,
  };
}

/**
 * Launchpad-wars series: per-bucket share of a chain's LAUNCHPAD volume for
 * its top launchpads, from hourly VenueVolume rows. 24h = 24×1h buckets,
 * 7d = 42×4h buckets, 30d = 60×12h buckets.
 */
const LP_SERIES_CFG: Record<LpRangeKey, { hours: number; agg: number }> = {
  '24h': { hours: 24, agg: 1 },
  '7d': { hours: 168, agg: 4 },
  '30d': { hours: 720, agg: 12 },
};

export async function buildLaunchpadSeries(chain: ChainCode, range: LpRangeKey): Promise<LaunchpadSeriesPayload> {
  const HOUR = 3600_000;
  const cfg = LP_SERIES_CFG[range];
  const anchorHour = Math.floor(Date.now() / HOUR) * HOUR;
  const from = anchorHour - (cfg.hours - 1) * HOUR;

  const rows = await prisma.venueVolume.findMany({
    where: { chain, ts: { gte: new Date(from) } },
    select: { venue: true, ts: true, volumeUsd: true },
  });

  /* hourly volume per launchpad venue */
  const byVenue = new Map<string, (number | null)[]>();
  for (const r of rows) {
    if (classifyVenue(r.venue) !== 'launchpad') continue;
    const idx = Math.round((r.ts.getTime() - from) / HOUR);
    if (idx < 0 || idx >= cfg.hours) continue;
    if (!byVenue.has(r.venue)) byVenue.set(r.venue, new Array(cfg.hours).fill(null));
    const arr = byVenue.get(r.venue)!;
    arr[idx] = (arr[idx] ?? 0) + Number(r.volumeUsd);
  }

  const totals = [...byVenue.entries()]
    .map(([name, arr]) => ({ name, total: arr.reduce((s: number, v) => s + (v ?? 0), 0) }))
    .sort((a, b) => b.total - a.total);
  const top = totals.slice(0, 6);

  const n = cfg.hours / cfg.agg;
  /* aggregate to chart buckets, then convert to share of the launchpad total */
  const groupVol = new Map<string, (number | null)[]>();
  for (const { name } of top) {
    const src = byVenue.get(name)!;
    const out: (number | null)[] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      let s = 0, seen = false;
      for (let j = 0; j < cfg.agg; j++) {
        const v = src[i * cfg.agg + j];
        if (v !== null) { s += v; seen = true; }
      }
      out[i] = seen ? s : null;
    }
    groupVol.set(name, out);
  }
  const groupTotal: number[] = new Array(n).fill(0);
  for (const arr of groupVol.values()) for (let i = 0; i < n; i++) groupTotal[i] += arr[i] ?? 0;

  const venues: LaunchpadSeriesVenue[] = top.map(({ name, total }) => ({
    name,
    totalUsd: total,
    shares: groupVol.get(name)!.map((v, i) =>
      v === null || groupTotal[i] <= 0 ? null : (v / groupTotal[i]) * 100
    ),
  }));

  return {
    chain,
    range,
    bucketMs: HOUR * cfg.agg,
    anchorTs: anchorHour - (cfg.agg - 1) * HOUR,
    venues,
    mode: DATA_MODE,
  };
}

/**
 * Example projects for one launchpad: top tokens by 24h volume, optionally
 * narrowed to one category (e.g. the AI projects currently running there).
 */
export async function buildLaunchpadTokens(
  chain: ChainCode, venue: string, category: TokenCategory | null
): Promise<LaunchpadTokensPayload> {
  const rows = await prisma.launchpadToken.findMany({
    where: { chain, venue, ...(category ? { category } : {}) },
    orderBy: { vol24Usd: 'desc' },
    take: category ? 10 : 16,
  });
  return {
    chain,
    venue,
    tokens: rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      category: (r.category as TokenCategory | null) ?? null,
      mcUsd: r.mcUsd !== null ? Number(r.mcUsd) : null,
      athMcUsd: r.athMcUsd !== null ? Number(r.athMcUsd) : null,
      startMcUsd: r.startMcUsd !== null ? Number(r.startMcUsd) : null,
      vol24Usd: Number(r.vol24Usd),
      change24: r.change24,
      launchedAt: r.launchedAt ? r.launchedAt.toISOString() : null,
      website: r.websiteUrl,
      twitter: r.twitterUrl,
      telegram: r.telegramUrl,
    })),
    mode: DATA_MODE,
  };
}

export async function buildAlerts(chain: ChainCode | null, limit: number): Promise<AlertRow[]> {
  const rows = await prisma.alert.findMany({
    where: chain ? { chain } : undefined,
    orderBy: { ts: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: Number(r.id),
    chain: r.chain as ChainCode,
    type: r.type as AlertType,
    message: r.message,
    ts: r.ts.toISOString(),
  }));
}
