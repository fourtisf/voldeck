import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

// cwd .env first, then the repo root .env (PM2 runs apps from their own dir)
dotenv.config();
const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });

export const API_PORT = Number(process.env.API_PORT || 4020);
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const WEB_ORIGIN = process.env.WEB_ORIGIN || '';
export const DATA_MODE: 'sim' | 'live' = process.env.DATA_MODE === 'live' ? 'live' : 'sim';
