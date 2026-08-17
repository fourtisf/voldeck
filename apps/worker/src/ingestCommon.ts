/**
 * Shared write-path for all live ingest sources (GeckoTerminal, DexScreener,
 * Robinfun). One source owns each 5-minute tick per chain, so these writes
 * never double-count.
 */
import { getPrisma } from '@voldeck/db';
import { classifyVenue, FINE_MS, type ChainCode } from '@voldeck/shared';
import { redisSet } from './redis';

const prisma = getPrisma();

export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** The just-completed aligned 5m bucket (the m5 rolling window ≈ this). */
export function currentFineBucketTs(): Date {
  return new Date(Math.floor(Date.now() / FINE_MS) * FINE_MS - FINE_MS);
}

export async function writeFineBucket(ch: ChainCode, volumeUsd: number, txns: number): Promise<Date> {
  const bucketTs = currentFineBucketTs();
  const volume = round2(volumeUsd);
  await prisma.volumeBucket.upsert({
    where: { chain_tier_bucketTs: { chain: ch, tier: 'fine', bucketTs } },
    update: { volumeUsd: volume, txns },
    create: { chain: ch, tier: 'fine', bucketTs, volumeUsd: volume, txns },
  });
  return bucketTs;
}

export async function incrementVenueHour(ch: ChainCode, byVenue: Map<string, number>): Promise<void> {
  const hourTs = new Date(Math.floor(Date.now() / 3600_000) * 3600_000);
  for (const [venue, vol] of byVenue) {
    const v = round2(vol);
    if (v <= 0) continue;
    await prisma.venueVolume.upsert({
      where: { chain_venue_ts: { chain: ch, venue, ts: hourTs } },
      update: { volumeUsd: { increment: v } },
      create: { chain: ch, venue, ts: hourTs, volumeUsd: v },
    });
  }
}

export interface LiveTokenAgg {
  symbol: string;
  name: string;
  address: string | null;
  vol24: number;
  mc: number | null;
  change24: number | null;
  launchedAt: Date | null;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
}

/** Best-effort category from the token's name/symbol (live mode has no real taxonomy). */
export function guessCategory(name: string, symbol: string): 'meme' | 'animal' | 'ai' | 'gaming' | 'politifi' | 'utility' {
  const s = (name + ' ' + symbol).toLowerCase();
  if (/trump|biden|maga|elect|president|politic|senat|congress/.test(s)) return 'politifi';
  if (/\bai\b|gpt|agent|neural|llm|brain|intellig/.test(s)) return 'ai';
  if (/game|play|quest|arcade|loot|rpg/.test(s)) return 'gaming';
  if (/dog|doge|inu|shib|cat\b|kitty|pepe|frog|duck|bird|ape|monkey|hamster|capy|pengu|goat|wolf|fox|bonk|moo\b|pup/.test(s)) return 'animal';
  if (/swap\b|bridge|stake|yield|payment/.test(s)) return 'utility';
  return 'meme';
}

/** Upsert top tokens per LAUNCHPAD venue (ATH MC ratchets up; socials kept once found). */
export async function upsertLaunchpadTokens(ch: ChainCode, byVenueToken: Map<string, Map<string, LiveTokenAgg>>): Promise<void> {
  for (const [venue, tokens] of byVenueToken) {
    if (classifyVenue(venue) !== 'launchpad') continue;
    const top = [...tokens.values()].sort((a, b) => b.vol24 - a.vol24).slice(0, 8);
    for (const t of top) {
      const vol24 = round2(t.vol24);
      const mc = t.mc !== null ? round2(t.mc) : null;
      const existing = await prisma.launchpadToken.findUnique({
        where: { chain_venue_symbol: { chain: ch, venue, symbol: t.symbol } },
        select: { athMcUsd: true, socialsCheckedAt: true },
      });
      const prevAth = existing?.athMcUsd !== null && existing?.athMcUsd !== undefined ? Number(existing.athMcUsd) : null;
      const ath = mc !== null ? Math.max(prevAth ?? 0, mc) : prevAth;
      const hasSocials = Boolean(t.website || t.twitter || t.telegram);
      const socials = hasSocials
        ? { websiteUrl: t.website ?? null, twitterUrl: t.twitter ?? null, telegramUrl: t.telegram ?? null, socialsCheckedAt: new Date() }
        : {};
      await prisma.launchpadToken.upsert({
        where: { chain_venue_symbol: { chain: ch, venue, symbol: t.symbol } },
        update: {
          name: t.name, address: t.address, vol24Usd: vol24, mcUsd: mc, athMcUsd: ath,
          change24: t.change24, launchedAt: t.launchedAt ?? undefined, ...socials,
        },
        create: {
          chain: ch, venue, symbol: t.symbol, name: t.name,
          category: guessCategory(t.name, t.symbol),
          address: t.address, vol24Usd: vol24, mcUsd: mc, athMcUsd: ath,
          change24: t.change24, launchedAt: t.launchedAt, ...socials,
        },
      });
    }
  }
}

export async function cacheTxns24(ch: ChainCode, tx24: number): Promise<void> {
  await redisSet(`voldeck:txns24:${ch}`, String(Math.round(tx24)), 900);
}
