# VOLDECK — Multi-Chain Memecoin Volume Terminal

Tracks **aggregate memecoin trading volume per chain** (not individual tokens) across
Solana, Ethereum, BNB Chain and Robinhood Chain. Overview (stats strip, multi-chain
chart with Lines/Stacked/Bubbles, chains table, hourly heatmap, dominance, rotation,
flow alerts) plus a per-chain detail page (bar chart + MA, venue breakdown, stats
grid, heat strip, chain alerts). The UI is a faithful 1:1 port of the approved
`voldeck-prototype.html`.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js 14 (App Router) frontend, plain CSS ported from the prototype, vanilla canvas charts in client components — no chart libraries |
| `apps/api` | Fastify API (`/api/*`), Redis response cache, CORS locked to `WEB_ORIGIN` |
| `apps/worker` | Ingestion: SIM engine or live (GeckoTerminal + Robinfun), alert engine, coarse rollup, retention |
| `packages/shared` | Chain config, range→tier table, denylist, formatters, API payload types |
| `packages/db` | Prisma schema + client (`VolumeBucket`, `VenueVolume`, `Alert`) |

## Data model

Two-tier buckets in `VolumeBucket`:

- **fine** — 5-minute buckets, retained 14 days
- **coarse** — 15-minute buckets (rollup of 3 fine), retained 90 days

Range → tier mapping (server-side aggregation):

| Range | Tier | Agg | Points |
|---|---|---|---|
| 1H | fine | 1 | 12 |
| 4H | fine | 1 | 48 |
| 12H | fine | 3 (15m) | 48 |
| 24H | coarse | 1 | 96 |
| 7D | coarse | 4 (1h) | 168 |
| 1M | coarse | 16 (4h) | 180 |

Missing buckets are `null` in API series and render as chart gaps — never zeros,
never faked backfill. Charts grow as history accumulates from launch day.

## Modes

`DATA_MODE=sim` (default, ship first): the worker runs the prototype's
season/random-walk/spike generator and writes the same tables the live ingester
writes — the frontend cannot tell the difference. The status bar shows the
`SIM DATA` badge (bound to this flag via the API).

`DATA_MODE=live`:

- **SOL/ETH/BSC** — GeckoTerminal, every 5 min per chain (staggered 60s apart):
  top ~160 pools by 24h volume, base-token denylist filter
  (`packages/shared/src/denylist.ts`), sum of `volume_usd.m5` → fine bucket;
  per-dex sums → hourly `VenueVolume`; `transactions.h24` → Redis txns cache.
  32 calls / 5 min ≈ 6.4 req/min, exponential backoff on 429; failed cycles
  leave a gap.
- **RBH** — first-party Robinfun Postgres (read-only, `ROBINFUN_DATABASE_URL`);
  no-ops with a warning when unset. Venue split (Robinfun vs RobinSwap) adapts
  to whatever tag column the `trades` table has (inspected at startup).

**Alert engine** (both modes, every 5 min): surge ≥ +30% 1H, fade ≤ −20% 1H,
rotation |Δshare24h| ≥ 0.35pp checked hourly. Deduped: max 1 alert of a type
per chain per 30 min.

## Development

Requires Node 20+, pnpm, PostgreSQL, Redis.

```bash
pnpm install
cp .env.example .env                # adjust DATABASE_URL / REDIS_URL
pnpm --filter @voldeck/db migrate:dev
pnpm build                          # builds shared → db → apps
node apps/worker/dist/index.js      # seeds sim history on first run, then ticks
node apps/api/dist/index.js         # :4020
pnpm --filter @voldeck/web dev      # :3020 (proxies /api → :4020)
```

## Deployment (Hostinger VPS)

1. Node 20 LTS + pnpm; PostgreSQL + Redis (existing instances fine — create DB `voldeck`)
2. `pnpm install && pnpm build`, then `pnpm --filter @voldeck/db migrate:deploy`
3. Repo-root `.env` from `.env.example` (worker/api read it; keep `DATA_MODE=sim`)
4. `pm2 start ecosystem.config.js && pm2 save && pm2 startup` — web :3020, api :4020, worker
5. nginx: `deploy/nginx.conf.example` → `<DOMAIN>` → web, `<DOMAIN>/api` → api; `certbot --nginx`
6. `pm2 install pm2-logrotate` — the worker logs every ingest cycle (chain, calls, bucket value, latency)

**Launch sequence:** deploy with `DATA_MODE=sim` → verify UI parity against the
prototype → wire GeckoTerminal reachability + `ROBINFUN_DATABASE_URL` → flip
`DATA_MODE=live` (restart api + worker) → confirm buckets writing → done.

## Out of scope (Phase 2)

Telegram alert push, per-chain top-tokens drilldown, public API keys, WebSocket
streaming (frontend polls: overview/series 10s, alerts 8s), Bitquery
launchpad-native ingestion behind the same ingestor interface.
