import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getPrisma } from '@voldeck/db';
import { isChainCode, isRangeKey, isTokenCategory, ORDER, type ChainCode } from '@voldeck/shared';
import { API_PORT, WEB_ORIGIN, DATA_MODE } from './env';
import { cached } from './cache';
import { buildOverview, buildSeries, buildChainDetail, buildAlerts, buildLaunchpads, buildLaunchpadSeries, buildLaunchpadTokens, buildSearch } from './data';

const app = Fastify({ logger: true });

async function main(): Promise<void> {
  await app.register(cors, {
    // CORS locked to the web origin in production; open when unset (dev).
    origin: WEB_ORIGIN ? WEB_ORIGIN.split(',').map((s) => s.trim()) : true,
  });

  app.get('/api/health', async () => {
    const last = await getPrisma().volumeBucket.findFirst({
      where: { tier: 'fine' },
      orderBy: { bucketTs: 'desc' },
      select: { bucketTs: true },
    });
    const ageSec = last ? Math.round((Date.now() - last.bucketTs.getTime()) / 1000) : null;
    return {
      ok: true,
      mode: DATA_MODE,
      lastBucketTs: last?.bucketTs.toISOString() ?? null,
      dataAgeSec: ageSec,
      // two missed 5-minute cycles → the feed is stale
      stale: ageSec === null || ageSec > 900,
      ts: new Date().toISOString(),
    };
  });

  app.get('/api/overview', async () =>
    cached('voldeck:api:overview', 10, buildOverview)
  );

  app.get('/api/launchpads', async () =>
    cached('voldeck:api:launchpads', 15, buildLaunchpads)
  );

  app.get<{ Querystring: { chain?: string; range?: string } }>('/api/launchpads/series', async (req, reply) => {
    const chain = (req.query.chain ?? 'SOL').toUpperCase();
    if (!isChainCode(chain)) return reply.code(400).send({ error: 'bad chain' });
    const rangeRaw = req.query.range ?? '24h';
    const range = rangeRaw === '7d' || rangeRaw === '30d' ? rangeRaw : '24h';
    return cached(`voldeck:api:lpseries:${chain}:${range}`, 30, () => buildLaunchpadSeries(chain, range));
  });

  app.get<{ Querystring: { chain?: string; venue?: string; category?: string } }>('/api/launchpads/tokens', async (req, reply) => {
    const chain = (req.query.chain ?? '').toUpperCase();
    if (!isChainCode(chain)) return reply.code(400).send({ error: 'bad chain' });
    const venue = (req.query.venue ?? '').trim();
    if (!venue || venue.length > 80) return reply.code(400).send({ error: 'bad venue' });
    const catRaw = (req.query.category ?? '').toLowerCase();
    const category = isTokenCategory(catRaw) ? catRaw : null;
    if (catRaw && !category) return reply.code(400).send({ error: 'bad category' });
    return cached(`voldeck:api:lptokens:${chain}:${venue}:${category ?? 'all'}`, 30, () =>
      buildLaunchpadTokens(chain, venue, category)
    );
  });

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2 || q.length > 60) return reply.code(400).send({ error: 'q must be 2-60 chars' });
    return cached(`voldeck:api:search:${q.toLowerCase()}`, 10, () => buildSearch(q));
  });

  app.get<{ Querystring: { range?: string; chains?: string } }>('/api/series', async (req, reply) => {
    const range = req.query.range ?? '24h';
    if (!isRangeKey(range)) return reply.code(400).send({ error: 'bad range' });
    const chains = (req.query.chains ?? ORDER.join(','))
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(isChainCode);
    if (!chains.length) return reply.code(400).send({ error: 'bad chains' });
    const key = `voldeck:api:series:${range}:${[...chains].sort().join(',')}`;
    return cached(key, 15, () => buildSeries(range, chains));
  });

  app.get<{ Params: { code: string } }>('/api/chain/:code', async (req, reply) => {
    const code = req.params.code.toUpperCase();
    if (!isChainCode(code)) return reply.code(404).send({ error: 'unknown chain' });
    return cached(`voldeck:api:chain:${code}`, 10, () => buildChainDetail(code));
  });

  app.get<{ Params: { code: string }; Querystring: { range?: string } }>(
    '/api/chain/:code/series',
    async (req, reply) => {
      const code = req.params.code.toUpperCase();
      if (!isChainCode(code)) return reply.code(404).send({ error: 'unknown chain' });
      const range = req.query.range ?? '24h';
      if (!isRangeKey(range)) return reply.code(400).send({ error: 'bad range' });
      return cached(`voldeck:api:series:${range}:${code}`, 15, () => buildSeries(range, [code]));
    }
  );

  app.get<{ Querystring: { chain?: string; limit?: string } }>('/api/alerts', async (req, reply) => {
    const chainRaw = (req.query.chain ?? '').toUpperCase();
    let chain: ChainCode | null = null;
    if (chainRaw) {
      if (!isChainCode(chainRaw)) return reply.code(400).send({ error: 'bad chain' });
      chain = chainRaw;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    return cached(`voldeck:api:alerts:${chain ?? 'all'}:${limit}`, 5, async () => ({
      alerts: await buildAlerts(chain, limit),
    }));
  });

  await app.listen({ port: API_PORT, host: '0.0.0.0' });
}

main().catch((e) => {
  app.log.error(e);
  process.exit(1);
});
