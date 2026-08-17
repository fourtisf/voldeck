/**
 * RBH ingestion — first-party data from the Robinfun Postgres (read-only).
 * This is the product's moat: no aggregator has this data.
 *
 * Every 5 minutes: SELECT sum(usd_value) FROM trades WHERE ts >= bucket_start
 * AND ts < bucket_end. The venue split (Robinfun bonding-curve vs RobinSwap
 * AMM) is derived from whatever tag column the trades table actually has —
 * the schema is inspected at startup and the first matching column of
 * `venue`, `source`, `kind`, `pool_type`, `trade_type` is used; if none
 * exists all volume is attributed to "Robinfun".
 *
 * No-ops with a warning when ROBINFUN_DATABASE_URL is empty.
 */
import { Pool } from 'pg';
import { getPrisma } from '@voldeck/db';
import { CHAINS, FINE_MS } from '@voldeck/shared';
import { ROBINFUN_DATABASE_URL } from './env';
import { redisSet } from './redis';
import { log } from './log';

const prisma = getPrisma();

const VENUE_COLUMN_CANDIDATES = ['venue', 'source', 'kind', 'pool_type', 'trade_type'];

let pool: Pool | null = null;
let venueColumn: string | null | undefined; // undefined = not yet inspected

function venueLabel(tag: string | null): string {
  const t = (tag ?? '').toLowerCase();
  if (t.includes('swap') || t.includes('amm')) return 'RobinSwap';
  return 'Robinfun';
}

async function inspectSchema(): Promise<void> {
  if (venueColumn !== undefined) return;
  const res = await pool!.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'trades'`
  );
  const cols = new Set(res.rows.map((r: { column_name: string }) => r.column_name));
  venueColumn = VENUE_COLUMN_CANDIDATES.find((c) => cols.has(c)) ?? null;
  log.info('robinfun schema inspected', { columns: [...cols], venueColumn });
}

async function ingestBucket(): Promise<void> {
  const t0 = Date.now();
  await inspectSchema();
  const bucketStart = new Date(Math.floor(Date.now() / FINE_MS) * FINE_MS - FINE_MS);
  const bucketEnd = new Date(bucketStart.getTime() + FINE_MS);

  const volRes = await pool!.query(
    `SELECT COALESCE(sum(usd_value), 0) AS vol, count(*) AS n FROM trades WHERE ts >= $1 AND ts < $2`,
    [bucketStart, bucketEnd]
  );
  const volume = Math.round(Number(volRes.rows[0].vol) * 100) / 100;
  const txns = Number(volRes.rows[0].n);

  await prisma.volumeBucket.upsert({
    where: { chain_tier_bucketTs: { chain: 'RBH', tier: 'fine', bucketTs: bucketStart } },
    update: { volumeUsd: volume, txns },
    create: { chain: 'RBH', tier: 'fine', bucketTs: bucketStart, volumeUsd: volume, txns },
  });

  const hourTs = new Date(Math.floor(Date.now() / 3600_000) * 3600_000);
  if (venueColumn) {
    const splitRes = await pool!.query(
      `SELECT ${venueColumn} AS tag, COALESCE(sum(usd_value), 0) AS vol
       FROM trades WHERE ts >= $1 AND ts < $2 GROUP BY 1`,
      [bucketStart, bucketEnd]
    );
    const byVenue = new Map<string, number>();
    for (const row of splitRes.rows as { tag: string | null; vol: string }[]) {
      const venue = venueLabel(row.tag);
      byVenue.set(venue, (byVenue.get(venue) ?? 0) + Number(row.vol));
    }
    for (const [venue, v] of byVenue) {
      const inc = Math.round(v * 100) / 100;
      if (inc <= 0) continue;
      await prisma.venueVolume.upsert({
        where: { chain_venue_ts: { chain: 'RBH', venue, ts: hourTs } },
        update: { volumeUsd: { increment: inc } },
        create: { chain: 'RBH', venue, ts: hourTs, volumeUsd: inc },
      });
    }
  } else if (volume > 0) {
    await prisma.venueVolume.upsert({
      where: { chain_venue_ts: { chain: 'RBH', venue: 'Robinfun', ts: hourTs } },
      update: { volumeUsd: { increment: volume } },
      create: { chain: 'RBH', venue: 'Robinfun', ts: hourTs, volumeUsd: volume },
    });
  }

  const txRes = await pool!.query(
    `SELECT count(*) AS n FROM trades WHERE ts >= now() - interval '24 hours'`
  );
  await redisSet('voldeck:txns24:RBH', String(txRes.rows[0].n), 900);

  log.info('robinfun ingest', {
    chain: 'RBH', calls: 1, bucket: bucketStart.toISOString(),
    volumeUsd: volume, latencyMs: Date.now() - t0,
  });
}

export function startRobinfun(): void {
  if (!ROBINFUN_DATABASE_URL) {
    log.warn('ROBINFUN_DATABASE_URL empty — RBH live ingestion disabled (buckets will be gaps)');
    return;
  }
  pool = new Pool({ connectionString: ROBINFUN_DATABASE_URL, max: 2 });
  const run = () => ingestBucket().catch((e) => log.error('robinfun ingest failed', e));
  // stagger to t+180s in the 5m cycle, after the gecko chains
  setTimeout(() => {
    run();
    setInterval(run, 5 * 60_000);
  }, 180_000);
  log.info('robinfun scheduler started');
}
