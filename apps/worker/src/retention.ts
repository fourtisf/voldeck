/**
 * Retention: fine > 14d, coarse > 90d, alerts > 30d, venue > 90d.
 * Runs hourly.
 */
import { getPrisma } from '@voldeck/db';
import {
  FINE_RETENTION_DAYS, COARSE_RETENTION_DAYS,
  ALERT_RETENTION_DAYS, VENUE_RETENTION_DAYS,
} from '@voldeck/shared';
import { log } from './log';

const prisma = getPrisma();

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600_000);

export async function runRetention(): Promise<void> {
  const fine = await prisma.volumeBucket.deleteMany({
    where: { tier: 'fine', bucketTs: { lt: daysAgo(FINE_RETENTION_DAYS) } },
  });
  const coarse = await prisma.volumeBucket.deleteMany({
    where: { tier: 'coarse', bucketTs: { lt: daysAgo(COARSE_RETENTION_DAYS) } },
  });
  const alerts = await prisma.alert.deleteMany({
    where: { ts: { lt: daysAgo(ALERT_RETENTION_DAYS) } },
  });
  const venues = await prisma.venueVolume.deleteMany({
    where: { ts: { lt: daysAgo(VENUE_RETENTION_DAYS) } },
  });
  if (fine.count || coarse.count || alerts.count || venues.count) {
    log.info('retention swept', {
      fine: fine.count, coarse: coarse.count, alerts: alerts.count, venues: venues.count,
    });
  }
}

export function startRetention(): void {
  const run = () => runRetention().catch((e) => log.error('retention failed', e));
  setTimeout(run, 2 * 60_000);
  setInterval(run, 60 * 60_000);
  log.info('retention started');
}
