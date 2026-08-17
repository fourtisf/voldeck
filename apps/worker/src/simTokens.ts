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

const NAME_POOLS: Record<'meme' | 'animal' | 'ai' | 'gaming' | 'politifi' | 'utility', [string, string][]> = {
  meme: [
    ['Space Potato', 'TATER'], ['Crying Wojak', 'WOJAK'], ['Banana Phone', 'BNPH'],
    ['Honk Goblin', 'HONK'], ['Sad Broccoli', 'BROC'], ['Melting Cheese', 'CHEEZ'],
    ['Screaming Lemon', 'LEMON'], ['Cosmic Donut', 'DONUT'], ['Angry Cloud', 'ACLOUD'],
    ['Potato King', 'PKING'], ['Rubber Chicken', 'RUBCHK'], ['Giga Toast', 'GTOAST'],
  ],
  animal: [
    ['Zoomer Frog', 'ZFROG'], ['Sigma Cat', 'SIGCAT'], ['Toaster Dog', 'TOAST'],
    ['Grumpy Whale', 'GWHALE'], ['Rocket Hamster', 'HAMMY'], ['Turbo Snail', 'TSNAIL'],
    ['Moon Goose', 'GOOSE'], ['Pixel Pug', 'PPUG'], ['Angry Capybara', 'CAPY'],
    ['Laser Duck', 'LDUCK'], ['Chad Penguin', 'CHDPNG'], ['Fomo Ferret', 'FOMOF'],
    ['Disco Otter', 'DOTTER'], ['Ninja Gecko', 'NGECKO'], ['Baby Moose', 'BMOOSE'],
    ['Quantum Quokka', 'QUOKKA'],
  ],
  ai: [
    ['Agent Alpha', 'AGENTA'], ['NeuraPad', 'NEURA'], ['PromptChain', 'PRMPT'],
    ['SynthMind', 'SYNTH'], ['DeepSignal', 'DSIG'], ['AI Oracle', 'ORACL'],
    ['CortexSwap', 'CRTX'], ['BotYard', 'BYARD'], ['VectorMuse', 'VMUSE'],
    ['AutoTrader AI', 'AUTOAI'], ['MindMesh', 'MMESH'], ['Sentient Sock', 'SSOCK'],
  ],
  gaming: [
    ['PixelQuest', 'PXQ'], ['Loot Goblin', 'LOOTG'], ['Arcade Ape', 'ARCAPE'],
    ['SpeedRun', 'SPDRN'], ['Boss Fight', 'BOSSF'], ['Mana Potion', 'MPOT'],
    ['Retro Racer', 'RRACER'], ['Guild Coin', 'GUILDC'],
  ],
  politifi: [
    ['Meme Senator', 'SNTR'], ['Ballot Box', 'BALLOT'], ['Filibuster', 'FLBSTR'],
    ['Lobby Cat', 'LOBBY'], ['Tax Haven', 'THAVEN'], ['Debate Night', 'DEBATE'],
    ['Executive Order', 'EXORD'], ['Term Limit', 'TLIMIT'],
  ],
  utility: [
    ['ChainPay', 'CPAY'], ['GasSaver', 'GSAVE'], ['BridgeBot', 'BRDG'],
    ['YieldHub', 'YHUB'], ['SnipeGuard', 'SGRD'], ['TxTracker', 'TXTRK'],
    ['FeeBurner', 'FBURN'], ['NodeRunner', 'NODER'],
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

/** Deterministic category mix across the six metas. */
function categoryFor(key: string): keyof typeof NAME_POOLS {
  const r = hash01(key);
  if (r < 0.28) return 'meme';
  if (r < 0.50) return 'animal';
  if (r < 0.68) return 'ai';
  if (r < 0.78) return 'gaming';
  if (r < 0.88) return 'politifi';
  return 'utility';
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
      // flagship launchpads carry a deep roster so every category filter has depth
      const count = (vi < 2 ? 13 : vi < 4 ? 9 : 6) + Math.floor(hash01(ch + venue) * 4); // 13-16 / 9-12 / 6-9
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
        /* placeholder socials: .example never resolves (clearly sim), the X
           link is a real cashtag search, t.me handle is fictional */
        const slug = pick[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        await prisma.launchpadToken.create({
          data: {
            chain: ch, venue, symbol: pick[1], name: pick[0], category: cat,
            mcUsd: round2(mc), athMcUsd: round2(ath), startMcUsd: round2(start),
            vol24Usd: round2(vol24), change24: rnd(-35, 90),
            launchedAt: new Date(Date.now() - rnd(2, 80) * 24 * 3600_000),
            websiteUrl: `https://${slug}.example`,
            twitterUrl: `https://x.com/search?q=%24${pick[1]}`,
            telegramUrl: `https://t.me/${slug}_portal`,
            socialsCheckedAt: new Date(),
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
