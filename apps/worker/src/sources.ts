/**
 * Multi-source live ingest orchestrator — all free, no API keys.
 *
 * Per chain, one tick every 5 minutes (chains staggered 60s apart). Exactly
 * ONE source owns a tick, so bucket/venue writes never double-count:
 *   - every 6th tick (~30 min) → GeckoTerminal DISCOVERY (full sweep; also
 *     refreshes the TrackedPool set and the socials fallback queue)
 *   - other ticks → DexScreener refresh of the tracked pools (~6 calls,
 *     300 req/min ceiling)
 *   - DexScreener failure/thin coverage → immediate GeckoTerminal fallback
 *
 * Net effect: GeckoTerminal usage drops to ~⅙ of the old schedule while the
 * site refreshes just as often, and either source can carry a full outage
 * of the other.
 */
import { ORDER, type ChainCode } from '@voldeck/shared';
import { geckoNetworkFor, ROBINFUN_DATABASE_URL, RBH_DS_CHAIN } from './env';
import { ingestChainGecko } from './gecko';
import { refreshChainDexScreener, discoverChainDexScreener } from './dexscreener';
import { log } from './log';

const DISCOVERY_EVERY = 6; // ticks

/** RBH can run DexScreener-only when Gecko doesn't index it (and Robinfun creds are absent). */
function isDsOnly(ch: ChainCode): boolean {
  return ch === 'RBH' && !ROBINFUN_DATABASE_URL && !geckoNetworkFor(ch) && Boolean(RBH_DS_CHAIN);
}

export function startIngest(): void {
  const chains = ORDER.filter((c) => geckoNetworkFor(c) || isDsOnly(c));
  const ticks: Record<string, number> = {};

  const runTick = async (ch: (typeof chains)[number]) => {
    const n = ticks[ch] ?? 0;
    ticks[ch] = n + 1;
    try {
      if (isDsOnly(ch)) {
        // no Gecko to fall back to — a failed tick is an honest gap
        if (n % DISCOVERY_EVERY === 0) await discoverChainDexScreener(ch);
        await refreshChainDexScreener(ch);
        return;
      }
      // Discovery refreshes the pool universe but does NOT write the bucket:
      // DexScreener stays the single measuring source so the series never
      // steps up/down just because the source rotated.
      if (n % DISCOVERY_EVERY === 0) await ingestChainGecko(ch, { writeBucket: false });
      const ok = await refreshChainDexScreener(ch);
      // fallback: only here does Gecko own the number
      if (!ok) await ingestChainGecko(ch, { writeBucket: true });
    } catch (e) {
      log.error(`ingest tick failed for ${ch}`, e);
    }
  };

  const cycle = () => {
    chains.forEach((ch, i) => {
      setTimeout(() => { void runTick(ch); }, i * 60_000);
    });
  };
  cycle();
  setInterval(cycle, 5 * 60_000);
  log.info('multi-source ingest started', { chains, discoveryEveryTicks: DISCOVERY_EVERY });
}
