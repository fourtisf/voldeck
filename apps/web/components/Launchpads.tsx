'use client';

/**
 * Cross-chain launchpad/venue leaderboard: which venue moves the most
 * memecoin volume across ALL tracked chains, last 24h. Filterable
 * All / Launchpads / DEX; rows link to the venue's chain detail.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CHAINS, fmtUsd, type VenueKind } from '@voldeck/shared';
import { useLaunchpads } from '@/lib/hooks';

type Filter = 'all' | VenueKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'launchpad', label: 'Launchpads' },
  { key: 'dex', label: 'DEX' },
  { key: 'all', label: 'All' },
];

export default function Launchpads() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('launchpad');
  const { data } = useLaunchpads();

  const rows = (data?.rows ?? []).filter((r) => filter === 'all' || r.kind === filter);
  const total = rows.reduce((s, r) => s + r.volumeUsd, 0);
  const max = rows[0]?.volumeUsd ?? 1;

  return (
    <div className="panel">
      <div className="phead">
        <span className="ttl">Launchpads</span>
        <span className="subt">memecoin vol by venue · 24h · all chains</span>
        <span className="sp"></span>
        <div className="seg">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="lpbody">
        {rows.length ? rows.map((r, i) => (
          <div className="lpr" key={r.chain + ':' + r.venue} onClick={() => router.push('/chain/' + r.chain)}>
            <span className="rk">#{i + 1}</span>
            <span className="nm">
              <span className="dot" style={{ background: CHAINS[r.chain].color }}></span>
              {r.venue}
              <span className="tk">{r.chain}</span>
            </span>
            <span className="bar"><i style={{ width: (r.volumeUsd / max) * 100 + '%', background: CHAINS[r.chain].color }}></i></span>
            <span className="pct">{total > 0 ? ((r.volumeUsd / total) * 100).toFixed(0) + '%' : '--'}</span>
            <span className="val">{fmtUsd(r.volumeUsd)}</span>
          </div>
        )) : (
          <div className="lpr" style={{ cursor: 'default' }}><span className="subt">No venue data yet</span></div>
        )}
      </div>
    </div>
  );
}
