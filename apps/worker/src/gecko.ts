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
import { CHAINS, ORDER, isDenylisted, classifyVenue, FINE_MS, type ChainCode } from '@voldeck/shared';
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
    market_cap_usd?: string | null;
    fdv_usd?: string | null;
    price_change_percentage?: Record<string, string | null>;
    pool_created_at?: string | null;
  };
  relationships?: {
    dex?: { data?: { id?: string } };
    base_token?: { data?: { id?: string } };
  };
}

interface GeckoPage {
  data: GeckoPool[];
  included?: { id: string; type: string; attributes?: { name?: string; symbol?: string } }[];
}

interface TokenAgg {
  symbol: string;
  name: string;
  address: string | null;
  vol24: number;
  mc: number | null;
  change24: number | null;
  launchedAt: Date | null;
}

/** Best-effort category from the token's name/symbol (live mode has no real taxonomy). */
function guessCategory(name: string, symbol: string): 'meme' | 'ai' | null {
  const s = (name + ' ' + symbol).toLowerCase();
  if (/\bai\b|gpt|agent|neural|brain|bot\b/.test(s)) return 'ai';
  return 'meme';
}

async function fetchJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) return (await res.json()) as T;
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

const fetchPage = (url: string) => fetchJson<GeckoPage>(url);

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
  const tokenNames = new Map<string, { name: string; symbol: string }>();
  /* per dex venue: per base token aggregation for the launchpad drilldown */
  const byDexToken = new Map<string, Map<string, TokenAgg>>();
  let anyPageOk = false;

  for (let page = 1; page <= PAGES; page++) {
    const url = `${GECKO_BASE}/networks/${net}/pools?page=${page}&sort=h24_volume_usd_desc&include=dex,base_token`;
    calls++;
    const json = await fetchPage(url);
    if (!json) continue;
    anyPageOk = true;
    for (const inc of json.included ?? []) {
      if (inc.type === 'dex' && inc.attributes?.name) dexNames.set(inc.id, inc.attributes.name);
      if (inc.type === 'token' && inc.attributes?.symbol) {
        tokenNames.set(inc.id, { name: inc.attributes.name ?? inc.attributes.symbol, symbol: inc.attributes.symbol });
      }
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
      if (!dexId) continue;
      byDex.set(dexId, (byDex.get(dexId) ?? 0) + m5);

      /* token aggregation (drilldown) — same payload, no extra calls */
      const baseId = pool.relationships?.base_token?.data?.id;
      const tokMeta = baseId ? tokenNames.get(baseId) : undefined;
      const tokSymbol = tokMeta?.symbol ?? sym;
      if (!byDexToken.has(dexId)) byDexToken.set(dexId, new Map());
      const dexTokens = byDexToken.get(dexId)!;
      const agg = dexTokens.get(tokSymbol) ?? {
        symbol: tokSymbol, name: tokMeta?.name ?? tokSymbol,
        // token ids are "<network>_<address>"
        address: baseId ? baseId.slice(baseId.indexOf('_') + 1) : null,
        vol24: 0, mc: null, change24: null, launchedAt: null,
      };
      agg.vol24 += Number(pool.attributes?.volume_usd?.h24 ?? 0) || 0;
      const mc = Number(pool.attributes?.market_cap_usd ?? pool.attributes?.fdv_usd ?? NaN);
      if (Number.isFinite(mc) && mc > 0) agg.mc = Math.max(agg.mc ?? 0, mc);
      const chg = Number(pool.attributes?.price_change_percentage?.h24 ?? NaN);
      if (Number.isFinite(chg) && agg.change24 === null) agg.change24 = chg;
      const created = pool.attributes?.pool_created_at ? new Date(pool.attributes.pool_created_at) : null;
      if (created && (!agg.launchedAt || created < agg.launchedAt)) agg.launchedAt = created;
      dexTokens.set(tokSymbol, agg);
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

  /* top tokens per LAUNCHPAD venue → drilldown table (ATH MC ratchets up) */
  for (const [dexId, dexTokens] of byDexToken) {
    const venue = dexNames.get(dexId) ?? dexId;
    if (classifyVenue(venue) !== 'launchpad') continue;
    const top = [...dexTokens.values()].sort((a, b) => b.vol24 - a.vol24).slice(0, 8);
    for (const t of top) {
      const vol24 = Math.round(t.vol24 * 100) / 100;
      const mc = t.mc !== null ? Math.round(t.mc * 100) / 100 : null;
      const existing = await prisma.launchpadToken.findUnique({
        where: { chain_venue_symbol: { chain: ch, venue, symbol: t.symbol } },
        select: { athMcUsd: true },
      });
      const prevAth = existing?.athMcUsd !== null && existing?.athMcUsd !== undefined ? Number(existing.athMcUsd) : null;
      const ath = mc !== null ? Math.max(prevAth ?? 0, mc) : prevAth;
      await prisma.launchpadToken.upsert({
        where: { chain_venue_symbol: { chain: ch, venue, symbol: t.symbol } },
        update: { name: t.name, address: t.address, vol24Usd: vol24, mcUsd: mc, athMcUsd: ath, change24: t.change24, launchedAt: t.launchedAt ?? undefined },
        create: {
          chain: ch, venue, symbol: t.symbol, name: t.name,
          category: guessCategory(t.name, t.symbol),
          address: t.address,
          vol24Usd: vol24, mcUsd: mc, athMcUsd: ath, change24: t.change24,
          launchedAt: t.launchedAt,
        },
      });
    }
  }

  await fetchMissingSocials(ch, net);

  await redisSet(`voldeck:txns24:${ch}`, String(tx24), 900);
  log.info('gecko ingest', {
    chain: ch, calls, pools, dropped,
    bucket: bucketTs.toISOString(), volumeUsd: volume, latencyMs: Date.now() - t0,
  });
}

interface GeckoTokenInfo {
  data?: {
    attributes?: {
      websites?: string[];
      twitter_handle?: string | null;
      telegram_handle?: string | null;
    };
  };
}

const SOCIALS_PER_CYCLE = 3;

/**
 * Slow queue for project socials: each cycle, look up token info for up to
 * 3 tokens per chain that haven't been checked yet (+3 calls per chain per
 * 5 min — total stays well under the ~30 req/min free limit). Results are
 * cached permanently; failed lookups are marked checked so they don't loop.
 */
async function fetchMissingSocials(ch: ChainCode, net: string): Promise<void> {
  const pending = await prisma.launchpadToken.findMany({
    where: { chain: ch, socialsCheckedAt: null, address: { not: null } },
    orderBy: { vol24Usd: 'desc' },
    take: SOCIALS_PER_CYCLE,
  });
  for (const t of pending) {
    const info = await fetchJson<GeckoTokenInfo>(`${GECKO_BASE}/networks/${net}/tokens/${t.address}/info`);
    const attrs = info?.data?.attributes;
    await prisma.launchpadToken.update({
      where: { id: t.id },
      data: {
        websiteUrl: attrs?.websites?.[0] ?? null,
        twitterUrl: attrs?.twitter_handle ? 'https://x.com/' + attrs.twitter_handle : null,
        telegramUrl: attrs?.telegram_handle ? 'https://t.me/' + attrs.telegram_handle : null,
        socialsCheckedAt: new Date(),
      },
    });
    await sleep(1_500);
  }
  if (pending.length) log.info('socials fetched', { chain: ch, tokens: pending.length });
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
