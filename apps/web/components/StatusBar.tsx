'use client';

import { useSyncExternalStore } from 'react';
import { ORDER } from '@voldeck/shared';
import { useOverview } from '@/lib/hooks';
import { subscribeConn, getConnState, type ConnState } from '@/lib/conn';

const serverSnapshot: ConnState = { ok: true, latMs: 0 };

export default function StatusBar() {
  const conn = useSyncExternalStore(subscribeConn, getConnState, () => serverSnapshot);
  const { data } = useOverview();
  return (
    <div className="statusbar">
      <span>
        <span className={conn.ok ? 'ok' : 'err'}>●</span> {conn.ok ? 'Connected' : 'Reconnecting'}
      </span>
      <span>poll /api · 10s</span>
      <span>Lat <span id="lat">{conn.latMs}</span>ms</span>
      <span>{ORDER.length} chains</span>
      <span className="sp"></span>
      {data?.mode === 'sim' && <span className="sim">SIM DATA</span>}
    </div>
  );
}
