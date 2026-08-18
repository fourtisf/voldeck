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
import { ORDER } from '@voldeck/shared';
import { geckoNetworkFor } from './env';
import { ingestChainGecko } from './gecko';
import { refreshChainDexScreener } from './dexscreener';
import { log } from './log';

const DISCOVERY_EVERY = 6; // ticks

export function startIngest(): void {
  const chains = ORDER.filter((c) => geckoNetworkFor(c));
  const ticks: Record<string, number> = {};

  const runTick = async (ch: (typeof chains)[number]) => {
    const n = ticks[ch] ?? 0;
    ticks[ch] = n + 1;
    try {
      if (n % DISCOVERY_EVERY === 0) {
        await ingestChainGecko(ch);
        return;
      }
      const ok = await refreshChainDexScreener(ch);
      if (!ok) await ingestChainGecko(ch);
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
