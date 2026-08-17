import Redis from 'ioredis';
import { REDIS_URL } from './env';
import { log } from './log';

let client: Redis | undefined;
let warned = false;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
    client.on('error', (e) => {
      if (!warned) {
        warned = true;
        log.warn('redis unavailable — caches degraded', { error: String(e) });
      }
    });
  }
  return client;
}

export async function redisSet(key: string, value: string, ttlSec: number): Promise<void> {
  try {
    await getRedis().set(key, value, 'EX', ttlSec);
  } catch {
    /* cache-only — safe to drop */
  }
}
