export type ChainCode = 'SOL' | 'ETH' | 'BSC' | 'RBH';

export interface ChainInfo {
  code: ChainCode;
  name: string;
  full: string;
  color: string;
  /** GeckoTerminal network id — null for first-party chains (RBH via Robinfun DB). */
  geckoNetwork: string | null;
  /** Baseline 24h memecoin volume used by the SIM engine. */
  simBase: number;
  /** Average trade size in USD — used for the Avg trade stat and txns fallback. */
  avgTrade: number;
  /** Active pairs shown in stats (static MVP value, refreshed later from live data). */
  pairs: number;
}

export const CHAINS: Record<ChainCode, ChainInfo> = {
  SOL: { code: 'SOL', name: 'Solana',    full: 'Solana Mainnet',   color: '#14f195', geckoNetwork: 'solana', simBase: 1.15e9, avgTrade: 420,  pairs: 28430 },
  ETH: { code: 'ETH', name: 'Ethereum',  full: 'Ethereum Mainnet', color: '#627eea', geckoNetwork: 'eth',    simBase: 4.4e8,  avgTrade: 1850, pairs: 6910 },
  BSC: { code: 'BSC', name: 'BNB Chain', full: 'BNB Smart Chain',  color: '#f0b90b', geckoNetwork: 'bsc',    simBase: 3.2e8,  avgTrade: 640,  pairs: 9840 },
  RBH: { code: 'RBH', name: 'Robinhood', full: 'Robinhood Chain',  color: '#00c805', geckoNetwork: null,     simBase: 6.2e7,  avgTrade: 380,  pairs: 1260 },
};

export const ORDER: ChainCode[] = ['SOL', 'ETH', 'BSC', 'RBH'];

export function isChainCode(v: string): v is ChainCode {
  return v === 'SOL' || v === 'ETH' || v === 'BSC' || v === 'RBH';
}

/**
 * Venue split used by the SIM engine (extends the prototype's VENUES table
 * with each chain's full launchpad roster so the per-chain launchpad board
 * has a realistic competitive mix).
 */
export const SIM_VENUES: Record<ChainCode, [string, number][]> = {
  SOL: [
    ['Pump.fun / PumpSwap', 0.30], ['Raydium', 0.19], ['LetsBonk', 0.09], ['Meteora', 0.08],
    ['Moonshot', 0.045], ['Believe', 0.035], ['Boop.fun', 0.03], ['Jup Studio', 0.03],
    ['Raydium LaunchLab', 0.025], ['Heaven', 0.025], ['Daos.fun', 0.02], ['Bags', 0.02],
    ['Time.fun', 0.015], ['GoFundMeme', 0.01], ['Other', 0.085],
  ],
  ETH: [
    ['Uniswap', 0.70], ['SushiSwap', 0.06], ['Virtuals', 0.04], ['Clanker', 0.02],
    ['Zora', 0.02], ['Other', 0.16],
  ],
  BSC: [
    ['PancakeSwap', 0.38], ['Four.meme', 0.26], ['GraFun', 0.08], ['Flap', 0.06],
    ['Springboard', 0.05], ['Meme Rush', 0.04], ['Other', 0.13],
  ],
  RBH: [['Robinfun', 0.82], ['RobinSwap', 0.18]],
};
