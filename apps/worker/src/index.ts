import { getPrisma } from '@voldeck/db';
import { DATA_MODE } from './env';
import { seedIfEmpty, startSim } from './sim';
import { startSimTokens } from './simTokens';
import { startIngest } from './sources';
import { startRobinfun } from './robinfun';
import { startAlertEngine } from './alerts';
import { startRollup } from './rollup';
import { startRetention } from './retention';
import { log } from './log';

async function main(): Promise<void> {
  log.info('voldeck worker starting', { mode: DATA_MODE });
  await getPrisma().$connect();

  if (DATA_MODE === 'sim') {
    // Guard: once real data exists, sim must never write again — a stale
    // DATA_MODE=sim (e.g. a cached pm2 env) would otherwise poison live
    // history with generated numbers.
    const trackedPools = await getPrisma().trackedPool.count();
    if (trackedPools > 0) {
      log.error(`refusing to run SIM: ${trackedPools} tracked pools exist (this database has live data). ` +
        'Set DATA_MODE=live in .env, or wipe the tables first if you really want sim.');
      process.exit(1);
    }
    await seedIfEmpty();
    startSim();
    startSimTokens();
  } else {
    startIngest();
    startRobinfun();
    startRollup();
  }
  startAlertEngine();
  startRetention();
}

main().catch((e) => {
  log.error('fatal', e);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await getPrisma().$disconnect();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await getPrisma().$disconnect();
  process.exit(0);
});
