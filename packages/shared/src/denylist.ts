/**
 * Base-token denylist for GeckoTerminal ingestion: pools whose BASE token is
 * one of these are not memecoin flow (majors / stables / wrapped natives /
 * major LSTs) and are excluded from chain volume.
 * Matched case-insensitively against the pool's base token symbol.
 */
const DENY = [
  // natives + wrapped natives
  'ETH', 'WETH', 'SOL', 'WSOL', 'BNB', 'WBNB',
  // majors
  'BTC', 'WBTC', 'CBBTC', 'TBTC', 'LBTC',
  // stables
  'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDE', 'SUSDE', 'USDS',
  'PYUSD', 'USD1', 'USDD', 'FRAX', 'GUSD', 'USDP', 'LUSD', 'CRVUSD', 'GHO', 'USDY',
  // major LSTs / LRTs
  'STETH', 'WSTETH', 'RETH', 'CBETH', 'METH', 'WEETH', 'EZETH', 'RSETH', 'FRXETH', 'SFRXETH',
  'MSOL', 'JITOSOL', 'BSOL', 'JUPSOL', 'INF', 'BNSOL', 'WBETH', 'SLISBNB',
];

export const DENYLIST: ReadonlySet<string> = new Set(DENY);

export function isDenylisted(symbol: string): boolean {
  return DENYLIST.has(symbol.trim().toUpperCase());
}
