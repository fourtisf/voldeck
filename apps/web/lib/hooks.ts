'use client';

import useSWR from 'swr';
import type {
  OverviewPayload, SeriesPayload, ChainDetailPayload, AlertsPayload,
  LaunchpadsPayload, LaunchpadSeriesPayload, LaunchpadTokensPayload,
  SearchPayload, LpRangeKey, ChainCode, RangeKey,
} from '@voldeck/shared';
import { reportFetch } from './conn';

const fetcher = async <T>(url: string): Promise<T> => {
  const t0 = performance.now();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as T;
    reportFetch(performance.now() - t0, true);
    return json;
  } catch (e) {
    reportFetch(performance.now() - t0, false);
    throw e;
  }
};

/* Poll cadence per handoff §6: overview + visible series every 10s, alerts every 8s. */

export function useOverview() {
  return useSWR<OverviewPayload>('/api/overview', fetcher, {
    refreshInterval: 10_000,
    keepPreviousData: true,
  });
}

export function useSeries(range: RangeKey) {
  return useSWR<SeriesPayload>(`/api/series?range=${range}`, fetcher, {
    refreshInterval: 10_000,
    keepPreviousData: true,
  });
}

export function useLaunchpads() {
  return useSWR<LaunchpadsPayload>('/api/launchpads', fetcher, {
    refreshInterval: 10_000,
    keepPreviousData: true,
  });
}

export function useLaunchpadSeries(chain: ChainCode, range: LpRangeKey) {
  return useSWR<LaunchpadSeriesPayload>(`/api/launchpads/series?chain=${chain}&range=${range}`, fetcher, {
    refreshInterval: 30_000,
    keepPreviousData: true,
  });
}

export function useLaunchpadTokens(chain: ChainCode | null, venue: string | null, category: string | null = null) {
  const qs = chain && venue
    ? `chain=${chain}&venue=${encodeURIComponent(venue)}` + (category ? `&category=${category}` : '')
    : null;
  return useSWR<LaunchpadTokensPayload>(
    qs ? `/api/launchpads/tokens?${qs}` : null,
    fetcher,
    { refreshInterval: 30_000, keepPreviousData: true }
  );
}

/** Global search — pass null/short query to pause. No auto-refresh. */
export function useSearch(q: string | null) {
  return useSWR<SearchPayload>(
    q && q.length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : null,
    fetcher,
    { refreshInterval: 0, keepPreviousData: true, dedupingInterval: 3_000 }
  );
}

export function useChainDetail(code: ChainCode) {
  return useSWR<ChainDetailPayload>(`/api/chain/${code}`, fetcher, {
    refreshInterval: 10_000,
    keepPreviousData: true,
  });
}

export function useChainSeries(code: ChainCode, range: RangeKey) {
  return useSWR<SeriesPayload>(`/api/chain/${code}/series?range=${range}`, fetcher, {
    refreshInterval: 10_000,
    keepPreviousData: true,
  });
}

export function useAlerts(chain?: ChainCode, limit = 40) {
  const qs = chain ? `chain=${chain}&limit=${limit}` : `limit=${limit}`;
  return useSWR<AlertsPayload>(`/api/alerts?${qs}`, fetcher, {
    refreshInterval: 8_000,
    keepPreviousData: true,
  });
}
