/**
 * Two-tier bucket model (production):
 *  - fine: 5-minute buckets, retained 14 days
 *  - coarse: 15-minute buckets (rollup of 3 fine), retained 90 days
 * The prototype simulated 1m fine buckets; the UI is unchanged — the 1H view
 * simply renders 12 buckets of 5m.
 */
export const FINE_MS = 5 * 60_000;
export const COARSE_MS = 15 * 60_000;

export const FINE_RETENTION_DAYS = 14;
export const COARSE_RETENTION_DAYS = 90;
export const ALERT_RETENTION_DAYS = 30;
export const VENUE_RETENTION_DAYS = 90;

export type Tier = 'fine' | 'coarse';
export type RangeKey = '1h' | '4h' | '12h' | '24h' | '7d' | '1m';

export interface RangeCfg {
  src: Tier;
  /** number of source buckets summed per chart point */
  agg: number;
  /** number of chart points */
  n: number;
  /** x-axis label step (every Nth point) */
  step: number;
  /** bucket label shown in subtitle/tooltip */
  blbl: string;
  /** x label format */
  xl: 'hm' | 'h' | 'day' | 'date';
}

export const RANGES: Record<RangeKey, RangeCfg> = {
  '1h':  { src: 'fine',   agg: 1,  n: 12,  step: 2,  blbl: '5m',  xl: 'hm' },
  '4h':  { src: 'fine',   agg: 1,  n: 48,  step: 8,  blbl: '5m',  xl: 'hm' },
  '12h': { src: 'fine',   agg: 3,  n: 48,  step: 8,  blbl: '15m', xl: 'h' },
  '24h': { src: 'coarse', agg: 1,  n: 96,  step: 16, blbl: '15m', xl: 'h' },
  '7d':  { src: 'coarse', agg: 4,  n: 168, step: 24, blbl: '1h',  xl: 'day' },
  '1m':  { src: 'coarse', agg: 16, n: 180, step: 36, blbl: '4h',  xl: 'date' },
};

export const RANGE_KEYS: RangeKey[] = ['1h', '4h', '12h', '24h', '7d', '1m'];

export function isRangeKey(v: string): v is RangeKey {
  return Object.prototype.hasOwnProperty.call(RANGES, v);
}

export function tierMs(tier: Tier): number {
  return tier === 'fine' ? FINE_MS : COARSE_MS;
}

/** Duration of one aggregated chart bucket for a range. */
export function rangeBucketMs(rk: RangeKey): number {
  return tierMs(RANGES[rk].src) * RANGES[rk].agg;
}

/** Start of the current (in-progress) source bucket for a tier. */
export function tierAnchor(tier: Tier, now = Date.now()): number {
  const ms = tierMs(tier);
  return Math.floor(now / ms) * ms;
}
