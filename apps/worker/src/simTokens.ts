/**
 * SIM example projects per launchpad. Generates a stable set of fictional
 * tokens (meme / AI / utility) for every launchpad venue, sized to the
 * venue's weight, then walks their MC/volume every cycle so the drilldown
 * feels live. Names are invented — the SIM DATA badge covers the whole UI.
 * In live mode the same table is filled from real GeckoTerminal pool data.
 */
import { getPrisma } from '@voldeck/db';
import {
  CHAINS, ORDER, SIM_VENUES, classifyVenue, clamp, type ChainCode,
} from '@voldeck/shared';
import { log } from './log';

const prisma = getPrisma();
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

const NAME_POOLS: Record<'meme' | 'ai' | 'utility', [string, string][]> = {
  meme: [
    ['Zoomer Frog', 'ZFROG'], ['Sigma Cat', 'SIGCAT'], ['Toaster Dog', 'TOAST'],
    ['Grumpy Whale', 'GWHALE'], ['Rocket Hamster', 'HAMMY'], ['Space Potato', 'TATER'],
    ['Crying Wojak', 'WOJAK'], ['Banana Phone', 'BNPH'], ['Turbo Snail', 'TSNAIL'],
    ['Moon Goose', 'GOOSE'], ['Pixel Pug', 'PPUG'], ['Angry Capybara', 'CAPY'],
    ['Laser Duck', 'LDUCK'], ['Chad Penguin', 'CHDPNG'], ['Fomo Ferret', 'FOMOF'],
  ],
  ai: [
    ['Agent Alpha', 'AGENTA'], ['NeuraPad', 'NEURA'], ['PromptChain', 'PRMPT'],
    ['SynthMind', 'SYNTH'], ['DeepSignal', 'DSIG'], ['AI Oracle', 'ORACL'],
    ['CortexSwap', 'CRTX'], ['BotYard', 'BYARD'], ['VectorMuse', 'VMUSE'],
  ],
  utility: [
    ['ChainPay', 'CPAY'], ['GasSaver', 'GSAVE'], ['BridgeBot', 'BRDG'],
    ['YieldHub', 'YHUB'], ['SnipeGuard', 'SGRD'], ['TxTracker', 'TXTRK'],
  ],
};

function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Deterministic category mix: ~60% meme, ~25% AI, ~15% utility. */
function categoryFor(key: string): 'meme' | 'ai' | 'utility' {
  const r = hash01(key);
  return r < 0.6 ? 'meme' : r < 0.85 ? 'ai' : 'utility';
}

export async function seedLaunchpadTokens(): Promise<void> {
  let created = 0;
  for (const ch of ORDER) {
    const venues = SIM_VENUES[ch].filter(([name]) => classifyVenue(name) === 'launchpad');
    for (let vi = 0; vi < venues.length; vi++) {
      const [venue, share] = venues[vi];
      const existing = await prisma.launchpadToken.count({ where: { chain: ch, venue } });
      if (existing > 0) continue;
      /* venue weight scales project sizes: flagship launchpads carry 9-figure MCs */
      const venueDayVol = CHAINS[ch].simBase * share;
      const count = 5 + Math.floor(hash01(ch + venue) * 3); // 5-7
      const used = new Set<string>();
      for (let i = 0; i < count; i++) {
        const cat = categoryFor(ch + venue + i);
        const pool = NAME_POOLS[cat];
        let pick = pool[Math.floor(hash01(ch + venue + cat + i) * pool.length)];
        let guard = 0;
        while (used.has(pick[1]) && guard++ < pool.length) {
          pick = pool[(pool.indexOf(pick) + 1) % pool.length];
        }
        if (used.has(pick[1])) continue;
        used.add(pick[1]);
        /* rank 0 is the venue's current hype leader */
        const scale = Math.pow(0.45, i) * rnd(0.6, 1.4);
        const mc = clamp(venueDayVol * 0.35 * scale, 150_000, 900e6);
        const ath = mc * rnd(1.15, 6);
        const start = rnd(4_000, 12_000);
        const vol24 = mc * rnd(0.08, 0.7);
        await prisma.launchpadToken.create({
          data: {
            chain: ch, venue, symbol: pick[1], name: pick[0], category: cat,
            mcUsd: round2(mc), athMcUsd: round2(ath), startMcUsd: round2(start),
            vol24Usd: round2(vol24), change24: rnd(-35, 90),
            launchedAt: new Date(Date.now() - rnd(2, 80) * 24 * 3600_000),
          },
        });
        created++;
      }
    }
  }
  if (created) log.info('sim launchpad tokens seeded', { created });
}

/** Walk MC/volume so the drilldown moves; ATH ratchets up when MC crosses it. */
export async function updateLaunchpadTokens(): Promise<void> {
  const tokens = await prisma.launchpadToken.findMany();
  for (const t of tokens) {
    const mc = Math.max(50_000, Number(t.mcUsd ?? 0) * (1 + rnd(-0.06, 0.065)));
    const ath = Math.max(Number(t.athMcUsd ?? 0), mc);
    const vol24 = Math.max(10_000, Number(t.vol24Usd) * (1 + rnd(-0.08, 0.08)));
    const change24 = clamp((t.change24 ?? 0) * rnd(0.7, 1.1) + rnd(-6, 6), -85, 400);
    await prisma.launchpadToken.update({
      where: { id: t.id },
      data: { mcUsd: round2(mc), athMcUsd: round2(ath), vol24Usd: round2(vol24), change24 },
    });
  }
}

export function startSimTokens(): void {
  seedLaunchpadTokens().catch((e) => log.error('sim token seed failed', e));
  setInterval(() => {
    updateLaunchpadTokens().catch((e) => log.error('sim token update failed', e));
  }, 5 * 60_000);
  log.info('sim launchpad tokens started');
}
