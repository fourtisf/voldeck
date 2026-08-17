/**
 * Live ingestion for SOL / ETH / BSC via GeckoTerminal (free tier ~30 req/min).
 *
 * Every 5 minutes per chain (chains staggered 60s apart):
 *   pools?page=1..8&sort=h24_volume_usd_desc&include=dex  → top ~160 pools
 *   → drop pools whose BASE token is denylisted (majors/stables/LSTs)
 *   → sum volume_usd.m5            → that fine bucket's chain volume
 *   → sum per dex                  → hourly VenueVolume rows
 *   → sum transactions.h24         → Redis txns cache
 *
 * Budget: 4 chains × 8 pages = 32 calls / 5 min ≈ 6.4 req/min.
 * On 429: exponential backoff; if the cycle still fails, no bucket row is
 * written — the API returns null and the chart renders a gap (not zero).
 */
import { getPrisma } from '@voldeck/db';
import { CHAINS, ORDER, isDenylisted, FINE_MS, type ChainCode } from '@voldeck/shared';
import { GECKO_BASE } from './env';
import { redisSet } from './redis';
import { log } from './log';

const prisma = getPrisma();

const PAGES = 8;
const PAGE_DELAY_MS = 1_500;
const BACKOFFS_MS = [2_000, 4_000, 8_000, 16_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GeckoPool {
  attributes: {
    name: string; // "PEPE / WETH"
    volume_usd: Record<string, string | null>;
    transactions?: Record<string, { buys?: number; sells?: number } | undefined>;
  };
  relationships?: { dex?: { data?: { id?: string } } };
}

interface GeckoPage {
  data: GeckoPool[];
  included?: { id: string; type: string; attributes?: { name?: string } }[];
}

async function fetchPage(url: string): Promise<GeckoPage | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) return (await res.json()) as GeckoPage;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= BACKOFFS_MS.length) return null;
        log.warn('gecko backoff', { url, status: res.status, waitMs: BACKOFFS_MS[attempt] });
        await sleep(BACKOFFS_MS[attempt]);
        continue;
      }
      log.warn('gecko request failed', { url, status: res.status });
      return null;
    } catch (e) {
      if (attempt >= BACKOFFS_MS.length) {
        log.warn('gecko network error', { url, error: String(e) });
        return null;
      }
      await sleep(BACKOFFS_MS[attempt]);
    }
  }
}

function baseSymbol(poolName: string): string {
  return (poolName.split('/')[0] || '').trim();
}

export async function ingestChain(ch: ChainCode): Promise<void> {
  const net = CHAINS[ch].geckoNetwork;
  if (!net) return;
  const t0 = Date.now();
  let calls = 0;
  let volM5 = 0, txM5 = 0, tx24 = 0, pools = 0, dropped = 0;
  const byDex = new Map<string, number>();
  const dexNames = new Map<string, string>();
  let anyPageOk = false;

  for (let page = 1; page <= PAGES; page++) {
    const url = `${GECKO_BASE}/networks/${net}/pools?page=${page}&sort=h24_volume_usd_desc&include=dex`;
    calls++;
    const json = await fetchPage(url);
    if (!json) continue;
    anyPageOk = true;
    for (const inc of json.included ?? []) {
      if (inc.type === 'dex' && inc.attributes?.name) dexNames.set(inc.id, inc.attributes.name);
    }
    for (const pool of json.data ?? []) {
      const sym = baseSymbol(pool.attributes?.name ?? '');
      if (!sym || isDenylisted(sym)) { dropped++; continue; }
      pools++;
      const m5 = Number(pool.attributes?.volume_usd?.m5 ?? 0) || 0;
      volM5 += m5;
      const t5 = pool.attributes?.transactions?.m5;
      txM5 += (t5?.buys ?? 0) + (t5?.sells ?? 0);
      const t24 = pool.attributes?.transactions?.h24;
      tx24 += (t24?.buys ?? 0) + (t24?.sells ?? 0);
      const dexId = pool.relationships?.dex?.data?.id;
      if (dexId) byDex.set(dexId, (byDex.get(dexId) ?? 0) + m5);
    }
    if (page < PAGES) await sleep(PAGE_DELAY_MS);
  }

  if (!anyPageOk) {
    // Bucket intentionally left missing → renders as a gap client-side.
    log.warn('gecko cycle failed — bucket gap', { chain: ch, calls });
    return;
  }

  // The m5 rolling window ≈ the just-completed aligned 5m bucket.
  const bucketTs = new Date(Math.floor(Date.now() / FINE_MS) * FINE_MS - FINE_MS);
  const volume = Math.round(volM5 * 100) / 100;
  await prisma.volumeBucket.upsert({
    where: { chain_tier_bucketTs: { chain: ch, tier: 'fine', bucketTs } },
    update: { volumeUsd: volume, txns: txM5 },
    create: { chain: ch, tier: 'fine', bucketTs, volumeUsd: volume, txns: txM5 },
  });

  const hourTs = new Date(Math.floor(Date.now() / 3600_000) * 3600_000);
  for (const [dexId, vol] of byDex) {
    const venue = dexNames.get(dexId) ?? dexId;
    const v = Math.round(vol * 100) / 100;
    if (v <= 0) continue;
    await prisma.venueVolume.upsert({
      where: { chain_venue_ts: { chain: ch, venue, ts: hourTs } },
      update: { volumeUsd: { increment: v } },
      create: { chain: ch, venue, ts: hourTs, volumeUsd: v },
    });
  }

  await redisSet(`voldeck:txns24:${ch}`, String(tx24), 900);
  log.info('gecko ingest', {
    chain: ch, calls, pools, dropped,
    bucket: bucketTs.toISOString(), volumeUsd: volume, latencyMs: Date.now() - t0,
  });
}

/** 5-minute cycle with chains staggered 60s apart to stay far under rate limits. */
export function startGecko(): void {
  const chains = ORDER.filter((c) => CHAINS[c].geckoNetwork);
  const cycle = () => {
    chains.forEach((ch, i) => {
      setTimeout(() => {
        ingestChain(ch).catch((e) => log.error(`gecko ingest ${ch} failed`, e));
      }, i * 60_000);
    });
  };
  cycle();
  setInterval(cycle, 5 * 60_000);
  log.info('gecko scheduler started', { chains, pages: PAGES });
}
