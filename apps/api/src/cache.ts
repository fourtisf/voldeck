import Redis from 'ioredis';
import { REDIS_URL } from './env';

let client: Redis | undefined;
let warned = false;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
    client.on('error', (e) => {
      if (!warned) {
        warned = true;
        console.warn('[api] redis unavailable — responses computed uncached:', String(e));
      }
    });
  }
  return client;
}

/**
 * Redis-backed response cache. On any Redis failure the value is computed
 * directly — the cache is an optimization, never a dependency.
 */
export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  try {
    const hit = await getRedis().get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch { /* fall through to compute */ }
  const value = await fn();
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSec);
  } catch { /* ignore */ }
  return value;
}
