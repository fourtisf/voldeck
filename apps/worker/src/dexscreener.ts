/**
 * DexScreener source (free, no API key, ~300 req/min — an order of magnitude
 * more headroom than GeckoTerminal). Used as the PRIMARY 5-minute refresher:
 * it re-reads the pools discovered by GeckoTerminal (TrackedPool) in batches
 * of 30 addresses. Roughly 6 calls per chain per 5 minutes. Any failure makes
 * the orchestrator fall back to a full GeckoTerminal ingest for that tick.
 */
import { getPrisma } from '@voldeck/db';
import { isDenylisted, type ChainCode } from '@voldeck/shared';
import { RBH_DS_CHAIN } from './env';
import { fetchJson } from './gecko';
import {
  writeFineBucket, incrementVenueHour, upsertLaunchpadTokens, cacheTxns24,
  round2, type LiveTokenAgg,
} from './ingestCommon';
import { log } from './log';

const prisma = getPrisma();

const DS_BASE = 'https://api.dexscreener.com';
const DS_CHAIN: Partial<Record<ChainCode, string>> = {
  SOL: 'solana', ETH: 'ethereum', BSC: 'bsc',
  ...(RBH_DS_CHAIN ? { RBH: RBH_DS_CHAIN } : {}),
};
const BATCH = 30;
const MAX_POOLS = 180;
/** below this fraction of answered pools the data is too thin — fall back */
const MIN_COVERAGE = 0.3;

interface DsPair {
  pairAddress?: string;
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  volume?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', number>>;
  txns?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', { buys?: number; sells?: number }>>;
  priceChange?: Partial<Record<'m5' | 'h1' | 'h6' | 'h24', number>>;
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number; // ms epoch
  info?: {
    websites?: { label?: string; url?: string }[];
    socials?: { type?: string; url?: string }[];
  };
}

interface DsPairsResponse {
  pairs?: DsPair[] | null;
}

function socialUrl(pair: DsPair, type: string): string | null {
  const hit = pair.info?.socials?.find((s) => (s.type ?? '').toLowerCase() === type && s.url);
  return hit?.url ?? null;
}

/** Refresh one chain tick from DexScreener. Returns false → caller falls back to Gecko. */
export async function refreshChainDexScreener(ch: ChainCode): Promise<boolean> {
  const dsChain = DS_CHAIN[ch];
  if (!dsChain) return false;
  const t0 = Date.now();

  const tracked = await prisma.trackedPool.findMany({
    where: { chain: ch, lastSeenAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { vol24Usd: 'desc' },
    take: MAX_POOLS,
  });
  if (tracked.length < 10) return false; // discovery hasn't populated enough yet

  const byAddress = new Map(tracked.map((p) => [p.address.toLowerCase(), p]));
  let calls = 0, answered = 0, volM5 = 0, txM5 = 0, tx24 = 0, dropped = 0;
  const byVenue = new Map<string, number>();
  const byVenueToken = new Map<string, Map<string, LiveTokenAgg>>();

  for (let i = 0; i < tracked.length; i += BATCH) {
    const addrs = tracked.slice(i, i + BATCH).map((p) => p.address).join(',');
    calls++;
    const json = await fetchJson<DsPairsResponse>(`${DS_BASE}/latest/dex/pairs/${dsChain}/${addrs}`);
    const pairs = json?.pairs ?? [];
    for (const pair of pairs) {
      const known = pair.pairAddress ? byAddress.get(pair.pairAddress.toLowerCase()) : undefined;
      const sym = pair.baseToken?.symbol ?? known?.baseSymbol ?? '';
      if (!sym || isDenylisted(sym)) { dropped++; continue; }
      answered++;
      const m5 = Number(pair.volume?.m5 ?? 0) || 0;
      volM5 += m5;
      txM5 += (pair.txns?.m5?.buys ?? 0) + (pair.txns?.m5?.sells ?? 0);
      tx24 += (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0);

      // canonical venue name comes from discovery, not DexScreener's dexId
      const venue = known?.dexName ?? pair.dexId ?? 'Other';
      byVenue.set(venue, (byVenue.get(venue) ?? 0) + m5);

      const name = pair.baseToken?.name ?? known?.baseName ?? sym;
      if (!byVenueToken.has(venue)) byVenueToken.set(venue, new Map());
      const venueTokens = byVenueToken.get(venue)!;
      const agg = venueTokens.get(sym) ?? {
        symbol: sym, name, address: pair.baseToken?.address ?? known?.baseAddress ?? null,
        vol24: 0, mc: null, change24: null, launchedAt: null,
        website: null, twitter: null, telegram: null,
      };
      agg.vol24 += Number(pair.volume?.h24 ?? 0) || 0;
      const mc = Number(pair.marketCap ?? pair.fdv ?? NaN);
      if (Number.isFinite(mc) && mc > 0) agg.mc = Math.max(agg.mc ?? 0, mc);
      const chg = Number(pair.priceChange?.h24 ?? NaN);
      if (Number.isFinite(chg) && agg.change24 === null) agg.change24 = chg;
      if (pair.pairCreatedAt) {
        const created = new Date(pair.pairCreatedAt);
        if (!agg.launchedAt || created < agg.launchedAt) agg.launchedAt = created;
      }
      agg.website = agg.website ?? pair.info?.websites?.[0]?.url ?? null;
      agg.twitter = agg.twitter ?? socialUrl(pair, 'twitter');
      agg.telegram = agg.telegram ?? socialUrl(pair, 'telegram');
      venueTokens.set(sym, agg);
    }
  }

  if (answered / tracked.length < MIN_COVERAGE) {
    log.warn('dexscreener coverage too thin — falling back to gecko', {
      chain: ch, tracked: tracked.length, answered, calls,
    });
    return false;
  }

  const bucketTs = await writeFineBucket(ch, volM5, txM5);
  await incrementVenueHour(ch, byVenue);
  await upsertLaunchpadTokens(ch, byVenueToken);
  await cacheTxns24(ch, tx24);

  log.info('dexscreener ingest', {
    chain: ch, source: 'dexscreener', calls, pairs: answered, dropped,
    bucket: bucketTs.toISOString(), volumeUsd: round2(volM5), latencyMs: Date.now() - t0,
  });
  return true;
}
