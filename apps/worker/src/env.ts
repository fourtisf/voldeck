import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

// cwd .env first, then the repo root .env (PM2 runs apps from their own dir)
dotenv.config();
const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });

import { CHAINS, type ChainCode } from '@voldeck/shared';

export const DATA_MODE: 'sim' | 'live' = process.env.DATA_MODE === 'live' ? 'live' : 'sim';
export const GECKO_BASE = process.env.GECKO_BASE || 'https://api.geckoterminal.com/api/v2';
export const ROBINFUN_DATABASE_URL = process.env.ROBINFUN_DATABASE_URL || '';
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Robinhood Chain via public aggregators, once they index it — no code
 * change needed: set these in .env (the shakedown script detects the ids).
 * When ROBINFUN_DATABASE_URL is set, the first-party feed wins and the
 * public RBH ingest stays off so buckets are never double-written.
 */
export const RBH_GECKO_NETWORK = process.env.RBH_GECKO_NETWORK || '';
export const RBH_DS_CHAIN = process.env.RBH_DS_CHAIN || '';

/** GeckoTerminal network id for a chain, honoring the RBH env override. */
export function geckoNetworkFor(ch: ChainCode): string | null {
  if (ch === 'RBH') {
    if (ROBINFUN_DATABASE_URL) return null; // first-party feed owns RBH
    return RBH_GECKO_NETWORK || null;
  }
  return CHAINS[ch].geckoNetwork;
}
