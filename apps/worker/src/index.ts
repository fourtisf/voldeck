import { getPrisma } from '@voldeck/db';
import { DATA_MODE } from './env';
import { seedIfEmpty, startSim } from './sim';
import { startGecko } from './gecko';
import { startRobinfun } from './robinfun';
import { startAlertEngine } from './alerts';
import { startRollup } from './rollup';
import { startRetention } from './retention';
import { log } from './log';

async function main(): Promise<void> {
  log.info('voldeck worker starting', { mode: DATA_MODE });
  await getPrisma().$connect();

  if (DATA_MODE === 'sim') {
    await seedIfEmpty();
    startSim();
  } else {
    startGecko();
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
