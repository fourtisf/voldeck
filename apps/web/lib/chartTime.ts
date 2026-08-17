import { RANGES, MONTHS, DAYS, type RangeKey } from '@voldeck/shared';

const p2 = (n: number) => String(n).padStart(2, '0');

/** Bucket-start ts of point i, given the last point's ts and bucket duration. */
export function bTime(anchorTs: number, bucketMs: number, n: number, i: number): number {
  return anchorTs - (n - 1 - i) * bucketMs;
}

export function xLabel(rk: RangeKey, ts: number): string {
  const d = new Date(ts);
  const R = RANGES[rk];
  if (R.xl === 'hm') return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  if (R.xl === 'h') return p2(d.getUTCHours()) + ':00';
  if (R.xl === 'day') return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate();
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

export function tipTime(ts: number): string {
  const d = new Date(ts);
  return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' · ' +
    p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ' UTC';
}

/** HH:MM:SS UTC from an ISO timestamp (alert feed times). */
export function utcClock(iso: string): string {
  const d = new Date(iso);
  return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
}
