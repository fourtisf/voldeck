import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

// cwd .env first, then the repo root .env (PM2 runs apps from their own dir)
dotenv.config();
const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });

export const DATA_MODE: 'sim' | 'live' = process.env.DATA_MODE === 'live' ? 'live' : 'sim';
export const GECKO_BASE = process.env.GECKO_BASE || 'https://api.geckoterminal.com/api/v2';
export const ROBINFUN_DATABASE_URL = process.env.ROBINFUN_DATABASE_URL || '';
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
