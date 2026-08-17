/**
 * Coarse rollup (live mode): continuously aggregate 3 fine (5m) buckets into
 * one coarse (15m) bucket. Recomputes the recent window so late-arriving fine
 * buckets are folded in. The sim engine writes both tiers directly, so this
 * only runs in live mode.
 */
import { getPrisma } from '@voldeck/db';
import { ORDER, FINE_MS, COARSE_MS } from '@voldeck/shared';
import { log } from './log';

const prisma = getPrisma();

const LOOKBACK_MS = 2 * 60 * 60_000; // recompute the last 2h each pass

export async function runRollup(): Promise<void> {
  const now = Date.now();
  const from = Math.floor((now - LOOKBACK_MS) / COARSE_MS) * COARSE_MS;
  for (const ch of ORDER) {
    const fine = await prisma.volumeBucket.findMany({
      where: { chain: ch, tier: 'fine', bucketTs: { gte: new Date(from) } },
      select: { bucketTs: true, volumeUsd: true, txns: true },
    });
    if (!fine.length) continue;
    const groups = new Map<number, { vol: number; txns: number; count: number }>();
    for (const b of fine) {
      const ts = Math.floor(b.bucketTs.getTime() / COARSE_MS) * COARSE_MS;
      const g = groups.get(ts) ?? { vol: 0, txns: 0, count: 0 };
      g.vol += Number(b.volumeUsd);
      g.txns += b.txns ?? 0;
      g.count++;
      groups.set(ts, g);
    }
    for (const [ts, g] of groups) {
      const bucketTs = new Date(ts);
      const vol = Math.round(g.vol * 100) / 100;
      await prisma.volumeBucket.upsert({
        where: { chain_tier_bucketTs: { chain: ch, tier: 'coarse', bucketTs } },
        update: { volumeUsd: vol, txns: g.txns },
        create: { chain: ch, tier: 'coarse', bucketTs, volumeUsd: vol, txns: g.txns },
      });
    }
  }
}

export function startRollup(): void {
  const run = () => runRollup().catch((e) => log.error('rollup failed', e));
  setTimeout(() => {
    run();
    setInterval(run, 5 * 60_000);
  }, 45_000);
  log.info('rollup started', { fineMs: FINE_MS, coarseMs: COARSE_MS });
}
