/**
 * Venue classification for the cross-chain launchpad leaderboard.
 * Venue names come from config in sim mode and from GeckoTerminal dex names /
 * Robinfun tags in live mode, so classification is by name pattern.
 */
export type VenueKind = 'launchpad' | 'dex';

const LAUNCHPAD_PATTERNS = [
  'pump',        // Pump.fun / PumpSwap
  'four.meme', 'fourmeme',
  'robinfun',
  'bonk', 'letsbonk', 'launchlab',
  'moonshot', 'moonit',
  'boop',
  'virtuals',
  'daos.fun',
  'flap',
  'sunpump',
  'believe',
  'launchpad',
];

export function classifyVenue(name: string): VenueKind {
  const n = name.toLowerCase();
  return LAUNCHPAD_PATTERNS.some((p) => n.includes(p)) ? 'launchpad' : 'dex';
}
