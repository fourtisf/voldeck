/**
 * Alert engine — runs every 5 minutes after ingest (both sim and live):
 *   surge:    1H volume ≥ +30% vs previous 1H → "1H vol surge +N%"
 *   fade:     1H volume ≤ −20%               → "1H vol fade −N%"
 *   rotation: |Δ share24h vs prev 24h| ≥ 0.35pp, checked hourly
 *             → "Share +N.NNpp / 24h"
 * Dedupe: max 1 alert of the same type per chain per 30 minutes.
 */
import { getPrisma } from '@voldeck/db';
import { ORDER, FINE_MS, COARSE_MS, fmtPp, type ChainCode } from '@voldeck/shared';
import { log } from './log';

const prisma = getPrisma();

const DEDUPE_MS = 30 * 60_000;
const SURGE_PCT = 30;
const FADE_PCT = -20;
const ROTATION_PP = 0.35;

async function sumWindow(chain: ChainCode, tier: 'fine' | 'coarse', from: number, to: number): Promise<number | null> {
  const agg = await prisma.volumeBucket.aggregate({
    where: { chain, tier, bucketTs: { gte: new Date(from), lt: new Date(to) } },
    _sum: { volumeUsd: true },
    _count: true,
  });
  if (agg._count === 0) return null;
  return Number(agg._sum.volumeUsd ?? 0);
}

async function push(chain: ChainCode, type: 'surge' | 'fade' | 'rotation', message: string): Promise<void> {
  const dupe = await prisma.alert.findFirst({
    where: { chain, type, ts: { gte: new Date(Date.now() - DEDUPE_MS) } },
    select: { id: true },
  });
  if (dupe) return;
  await prisma.alert.create({ data: { chain, type, message } });
  log.info('alert', { chain, type, message });
}

let lastRotationCheckHour = -1;

export async function runAlertEngine(): Promise<void> {
  const now = Date.now();
  const fineAnchor = Math.floor(now / FINE_MS) * FINE_MS;

  /* surge / fade: trailing 1h vs the 1h before (12 fine buckets each) */
  for (const ch of ORDER) {
    const v1 = await sumWindow(ch, 'fine', fineAnchor - 12 * FINE_MS, fineAnchor);
    const p1 = await sumWindow(ch, 'fine', fineAnchor - 24 * FINE_MS, fineAnchor - 12 * FINE_MS);
    if (v1 === null || p1 === null || p1 <= 0) continue;
    const d = ((v1 - p1) / p1) * 100;
    if (d >= SURGE_PCT) await push(ch, 'surge', '1H vol surge +' + Math.round(d) + '%');
    else if (d <= FADE_PCT) await push(ch, 'fade', '1H vol fade −' + Math.round(-d) + '%');
  }

  /* rotation: checked once per hour, share of 24h vs previous 24h (coarse) */
  const hour = new Date(now).getUTCHours();
  if (hour !== lastRotationCheckHour) {
    lastRotationCheckHour = hour;
    const coarseAnchor = Math.floor(now / COARSE_MS) * COARSE_MS;
    const day = 96 * COARSE_MS;
    const cur: Partial<Record<ChainCode, number>> = {};
    const prev: Partial<Record<ChainCode, number>> = {};
    let curTot = 0, prevTot = 0;
    for (const ch of ORDER) {
      cur[ch] = (await sumWindow(ch, 'coarse', coarseAnchor - day, coarseAnchor)) ?? 0;
      prev[ch] = (await sumWindow(ch, 'coarse', coarseAnchor - 2 * day, coarseAnchor - day)) ?? 0;
      curTot += cur[ch]!;
      prevTot += prev[ch]!;
    }
    if (curTot > 0 && prevTot > 0) {
      for (const ch of ORDER) {
        const rot = (cur[ch]! / curTot - prev[ch]! / prevTot) * 100;
        if (Math.abs(rot) >= ROTATION_PP) {
          await push(ch, 'rotation', 'Share ' + fmtPp(rot) + ' / 24h');
        }
      }
    }
  }
}

export function startAlertEngine(): void {
  const run = () => runAlertEngine().catch((e) => log.error('alert engine failed', e));
  // offset past the ingest writes within each 5m cycle
  setTimeout(() => {
    run();
    setInterval(run, 5 * 60_000);
  }, 30_000);
  log.info('alert engine started');
}
