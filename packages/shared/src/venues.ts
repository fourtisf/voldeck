/**
 * Venue classification for the per-chain launchpad board.
 * Venue names come from config in sim mode and from GeckoTerminal dex names /
 * Robinfun tags in live mode, so classification is by name pattern. Patterns
 * cover the known memecoin launchpads per chain — extend this list as new
 * launchpads appear; anything unmatched counts as DEX flow.
 */
export type VenueKind = 'launchpad' | 'dex';

const LAUNCHPAD_PATTERNS = [
  // Solana
  'pump',            // Pump.fun / PumpSwap
  'bonk',            // LetsBonk.fun / Bonk.fun
  'launchlab',       // Raydium LaunchLab
  'moonshot', 'moonit',
  'believe',
  'boop',
  'daos.fun',
  'jup studio',
  'bags',
  'heaven',
  'time.fun',
  'gofundmeme',
  // BNB Chain
  'four.meme', 'fourmeme',
  'grafun', 'gra.fun',
  'flap',
  'springboard',     // PancakeSwap Springboard
  'meme rush',       // Binance Wallet Meme Rush
  // EVM / other
  'virtuals',
  'clanker',
  'zora',
  'sunpump',
  // Robinhood Chain (first-party)
  'robinfun',
  // generic
  'launchpad',
];

export function classifyVenue(name: string): VenueKind {
  const n = name.toLowerCase();
  return LAUNCHPAD_PATTERNS.some((p) => n.includes(p)) ? 'launchpad' : 'dex';
}
