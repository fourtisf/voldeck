'use client';

import type { ChainCode } from '@voldeck/shared';

/**
 * Bridge between search results and the Launchpads panel: request that a
 * venue's project drilldown be opened. Same-page → custom event; from
 * another route → sessionStorage handoff consumed by Launchpads on mount.
 */
export interface OpenVenueDetail {
  chain: ChainCode;
  venue: string;
}

export const OPEN_VENUE_EVENT = 'voldeck:open-venue';
export const PENDING_VENUE_KEY = 'voldeck:pending-venue';

export function requestOpenVenue(detail: OpenVenueDetail, navigate: (path: string) => void): void {
  if (window.location.pathname === '/') {
    window.dispatchEvent(new CustomEvent<OpenVenueDetail>(OPEN_VENUE_EVENT, { detail }));
  } else {
    try {
      sessionStorage.setItem(PENDING_VENUE_KEY, JSON.stringify(detail));
    } catch { /* private mode — drilldown just won't auto-open */ }
    navigate('/');
  }
}
