'use client';

/**
 * Tiny store tracking API poll health — feeds the status bar (latency,
 * connected state) from real fetches instead of the prototype's random value.
 */
export interface ConnState {
  ok: boolean;
  latMs: number;
}

let state: ConnState = { ok: true, latMs: 0 };
const listeners = new Set<() => void>();

export function reportFetch(latMs: number, ok: boolean): void {
  state = { ok, latMs: Math.round(latMs) };
  listeners.forEach((l) => l());
}

export function subscribeConn(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getConnState(): ConnState {
  return state;
}
