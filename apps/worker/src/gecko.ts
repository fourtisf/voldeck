/**
 * GeckoTerminal source (free, ~30 req/min): full top-pools sweep for a chain.
 * In the multi-source setup this runs as DISCOVERY every ~30 min per chain
 * (it both ingests the tick and refreshes the TrackedPool set that the
 * DexScreener refresher works from), and as FALLBACK whenever a DexScreener
 * refresh fails. Budget worst case stays far under the rate limit.
 */
import { getPrisma } from '@voldeck/db';
import { CHAINS, isDenylisted, type ChainCode } from '@voldeck/shared';
import { GECKO_BASE } from './env';
import {
  writeFineBucket, incrementVenueHour, upsertLaunchpadTokens, cacheTxns24,
  round2, type LiveTokenAgg,
} from './ingestCommon';
import { log } from './log';

const prisma = getPrisma();

const PAGES = 8;
const PAGE_DELAY_MS = 1_500;
const BACKOFFS_MS = [2_000, 4_000, 8_000, 16_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= BACKOFFS_MS.length) return null;
        log.warn('source backoff', { url, status: res.status, waitMs: BACKOFFS_MS[attempt] });
        await sleep(BACKOFFS_MS[attempt]);
        continue;
      }
      log.warn('source request failed', { url, status: res.status });
      return null;
    } catch (e) {
      if (attempt >= BACKOFFS_MS.length) {
        log.warn('source network error', { url, error: String(e) });
        return null;
      }
      await sleep(BACKOFFS_MS[attempt]);
    }
  }
}

interface GeckoPool {
  id?: string; // "<network>_<pooladdress>"
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

function baseSymbol(poolName: string): string {
  return (poolName.split('/')[0] || '').trim();
}

const afterUnderscore = (id: string) => id.slice(id.indexOf('_') + 1);

/** Full GeckoTerminal ingest for one chain tick. Also refreshes TrackedPool. */
export async function ingestChainGecko(ch: ChainCode): Promise<boolean> {
  const net = CHAINS[ch].geckoNetwork;
  if (!net) return false;
  const t0 = Date.now();
  let calls = 0, volM5 = 0, txM5 = 0, tx24 = 0, pools = 0, dropped = 0;
  const byVenue = new Map<string, number>();
  const dexNames = new Map<string, string>();
  const tokenNames = new Map<string, { name: string; symbol: string }>();
  const byVenueToken = new Map<string, Map<string, LiveTokenAgg>>();
  const tracked: { address: string; dexName: string; baseSymbol: string; baseName: string; baseAddress: string | null; vol24: number }[] = [];
  let anyPageOk = false;

  for (let page = 1; page <= PAGES; page++) {
    const url = `${GECKO_BASE}/networks/${net}/pools?page=${page}&sort=h24_volume_usd_desc&include=dex,base_token`;
    calls++;
    const json = await fetchJson<GeckoPage>(url);
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
      const venue = dexNames.get(dexId) ?? dexId;
      byVenue.set(venue, (byVenue.get(venue) ?? 0) + m5);

      const baseId = pool.relationships?.base_token?.data?.id;
      const tokMeta = baseId ? tokenNames.get(baseId) : undefined;
      const tokSymbol = tokMeta?.symbol ?? sym;
      const tokName = tokMeta?.name ?? tokSymbol;
      const tokAddress = baseId ? afterUnderscore(baseId) : null;
      const vol24 = Number(pool.attributes?.volume_usd?.h24 ?? 0) || 0;

      if (pool.id) {
        tracked.push({
          address: afterUnderscore(pool.id), dexName: venue,
          baseSymbol: tokSymbol, baseName: tokName, baseAddress: tokAddress, vol24,
        });
      }

      if (!byVenueToken.has(venue)) byVenueToken.set(venue, new Map());
      const dexTokens = byVenueToken.get(venue)!;
      const agg = dexTokens.get(tokSymbol) ?? {
        symbol: tokSymbol, name: tokName, address: tokAddress,
        vol24: 0, mc: null, change24: null, launchedAt: null,
      };
      agg.vol24 += vol24;
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
    log.warn('gecko cycle failed — bucket gap', { chain: ch, calls });
    return false;
  }

  const bucketTs = await writeFineBucket(ch, volM5, txM5);
  await incrementVenueHour(ch, byVenue);
  await upsertLaunchpadTokens(ch, byVenueToken);
  await cacheTxns24(ch, tx24);

  /* refresh the tracked-pool set the DexScreener refresher works from */
  const now = new Date();
  for (const p of tracked) {
    await prisma.trackedPool.upsert({
      where: { chain_address: { chain: ch, address: p.address } },
      update: { dexName: p.dexName, baseSymbol: p.baseSymbol, baseName: p.baseName, baseAddress: p.baseAddress, vol24Usd: round2(p.vol24), lastSeenAt: now },
      create: { chain: ch, address: p.address, dexName: p.dexName, baseSymbol: p.baseSymbol, baseName: p.baseName, baseAddress: p.baseAddress, vol24Usd: round2(p.vol24), lastSeenAt: now },
    });
  }

  await fetchMissingSocials(ch, net);
  log.info('gecko ingest', {
    chain: ch, source: 'gecko', calls, pools, dropped, tracked: tracked.length,
    bucket: bucketTs.toISOString(), volumeUsd: round2(volM5), latencyMs: Date.now() - t0,
  });
  return true;
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

/** Fallback socials queue for tokens DexScreener had no socials for. */
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
