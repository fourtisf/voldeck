import type { ChainCode } from './chains';
import type { RangeKey } from './ranges';
import type { VenueKind } from './venues';

export type DataMode = 'sim' | 'live';

export interface LeaderStat {
  chain: ChainCode;
  share: number;
}

export interface OverviewStats {
  vol24: number;
  d24: number;
  vol1h: number;
  vol6h: number;
  txns24: number;
  pairs: number;
  leader: LeaderStat;
}

export interface OverviewChainRow {
  chain: ChainCode;
  d1: number;
  d6: number;
  d24: number;
  vol1h: number;
  vol24: number;
  share: number;
  txns: number;
  /** true while the chain is in an active 1H surge (drives the SURGE pill) */
  surging: boolean;
  /** last 96 coarse buckets (24h of 15m), oldest first, null = gap */
  spark: (number | null)[];
}

export interface DominanceRow {
  chain: ChainCode;
  share: number;
  vol24: number;
}

export interface RotationRow {
  chain: ChainCode;
  share: number;
  sharePrev: number;
  rot: number;
}

export interface OverviewPayload {
  stats: OverviewStats;
  chains: OverviewChainRow[];
  dominance: DominanceRow[];
  rotation: RotationRow[];
  /** bucket start ts (ms) of the last spark bucket */
  anchorTs: number;
  /** spark bucket duration (ms) — 15m coarse */
  bucketMs: number;
  mode: DataMode;
}

export interface SeriesPayload {
  range: RangeKey;
  /** duration (ms) of one aggregated chart bucket */
  bucketMs: number;
  /** bucket start ts (ms) of the LAST point in each series */
  anchorTs: number;
  /** per chain: n points oldest-first, null = gap / not yet accumulated */
  series: Partial<Record<ChainCode, (number | null)[]>>;
  /** Δ% of the range window vs the previous window (bubble view) — null if unknown */
  deltas: Partial<Record<ChainCode, number | null>>;
}

export interface VenueRow {
  name: string;
  /** 0..1 share of the chain's venue-tracked 24h volume */
  share: number;
  volumeUsd: number;
}

export interface ChainDetailStats {
  vol5m: number;
  vol1h: number;
  vol6h: number;
  vol24: number;
  d1: number;
  d6: number;
  d24: number;
  txns24: number;
  /** UTC hour (0-23) with max volume in the last 24h */
  peakHourUtc: number;
  peakHourVol: number;
  avgTrade: number;
  pairs: number;
  share: number;
  sharePrev: number;
  rot: number;
}

export interface ChainDetailPayload {
  chain: ChainCode;
  rank: number;
  stats: ChainDetailStats;
  venues: VenueRow[];
  /** 24 hourly sums, oldest first */
  heat: number[];
  /** ts (ms) of the first heat hour's start */
  heatAnchorTs: number;
  surging: boolean;
  mode: DataMode;
}

export interface LaunchpadRow {
  venue: string;
  chain: ChainCode;
  kind: 'launchpad' | 'dex';
  volumeUsd: number;
}

export interface LaunchpadsPayload {
  /** all venues across all chains, last 24h, sorted by volume desc */
  rows: LaunchpadRow[];
  totalUsd: number;
  mode: DataMode;
}

/** Launchpad-wars chart ranges (hourly VenueVolume resolution). */
export type LpRangeKey = '24h' | '7d' | '30d';

export interface LaunchpadSeriesVenue {
  name: string;
  totalUsd: number;
  /** share (%) of the chain's launchpad volume per bucket, oldest first; null = gap */
  shares: (number | null)[];
}

export interface LaunchpadSeriesPayload {
  chain: ChainCode;
  range: LpRangeKey;
  bucketMs: number;
  /** bucket start ts (ms) of the last point */
  anchorTs: number;
  /** top launchpads by window volume, descending */
  venues: LaunchpadSeriesVenue[];
  mode: DataMode;
}

export const TOKEN_CATEGORIES = ['meme', 'animal', 'ai', 'gaming', 'politifi', 'utility'] as const;
export type TokenCategory = (typeof TOKEN_CATEGORIES)[number];

export function isTokenCategory(v: string): v is TokenCategory {
  return (TOKEN_CATEGORIES as readonly string[]).includes(v);
}

export interface LaunchpadTokenRow {
  symbol: string;
  name: string;
  category: TokenCategory | null;
  mcUsd: number | null;
  /** max MC observed since tracking began (not all-time before that) */
  athMcUsd: number | null;
  /** bonding-curve start MC where known */
  startMcUsd: number | null;
  vol24Usd: number;
  change24: number | null;
  /** ISO timestamp of launch, null if unknown */
  launchedAt: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
}

export interface LaunchpadTokensPayload {
  chain: ChainCode;
  venue: string;
  tokens: LaunchpadTokenRow[];
  mode: DataMode;
}

export interface SearchVenueHit {
  chain: ChainCode;
  venue: string;
  kind: VenueKind;
  vol24Usd: number;
}

export interface SearchTokenHit {
  chain: ChainCode;
  venue: string;
  symbol: string;
  name: string;
  category: TokenCategory | null;
  mcUsd: number | null;
  vol24Usd: number;
}

export interface SearchPayload {
  q: string;
  chains: ChainCode[];
  venues: SearchVenueHit[];
  tokens: SearchTokenHit[];
  mode: DataMode;
}

export type AlertType = 'surge' | 'fade' | 'rotation';

export interface AlertRow {
  id: number;
  chain: ChainCode;
  type: AlertType;
  message: string;
  /** ISO timestamp */
  ts: string;
}

export interface AlertsPayload {
  alerts: AlertRow[];
}

export interface HealthPayload {
  ok: boolean;
  mode: DataMode;
  /** ISO ts of the newest fine bucket, null when no data at all */
  lastBucketTs: string | null;
  /** seconds since that bucket, null when no data at all */
  dataAgeSec: number | null;
  /** true when the feed has missed two 5-minute cycles */
  stale: boolean;
  ts: string;
}
