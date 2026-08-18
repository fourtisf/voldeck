'use client';

import { useSyncExternalStore } from 'react';
import { ORDER } from '@voldeck/shared';
import { useHealth } from '@/lib/hooks';
import { subscribeConn, getConnState, type ConnState } from '@/lib/conn';

const serverSnapshot: ConnState = { ok: true, latMs: 0 };

function ageLabel(sec: number): string {
  if (sec < 90) return sec + 's';
  if (sec < 5400) return Math.round(sec / 60) + 'm';
  return Math.round(sec / 3600) + 'h';
}

export default function StatusBar() {
  const conn = useSyncExternalStore(subscribeConn, getConnState, () => serverSnapshot);
  const { data: health } = useHealth();
  const stale = health?.stale === true;

  return (
    <div className="statusbar">
      <span>
        <span className={conn.ok ? 'ok' : 'err'}>●</span> {conn.ok ? 'Connected' : 'Reconnecting'}
      </span>
      <span>poll /api · 10s</span>
      <span>Lat <span id="lat">{conn.latMs}</span>ms</span>
      <span>{ORDER.length} chains</span>
      {health?.dataAgeSec != null && (
        <span className={stale ? 'err' : undefined}>
          data {ageLabel(health.dataAgeSec)} old
        </span>
      )}
      <span className="sp"></span>
      {stale && <span className="err" style={{ fontWeight: 600 }}>STALE FEED</span>}
      {health?.mode === 'sim' && <span className="sim">SIM DATA</span>}
    </div>
  );
}
