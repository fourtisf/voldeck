'use client';

/**
 * Per-chain launchpad board: each chain's launchpads ranked against each
 * other (Pump.fun vs LetsBonk vs Moonshot on Solana, Four.meme vs GraFun vs
 * Flap on BNB, ...), last 24h. Chain tabs narrow to one chain; the kind seg
 * switches Launchpads / DEX / All venues. Percentages are the venue's share
 * of that chain's total venue volume; rows click through to chain detail.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CHAINS, ORDER, fmtUsd, type ChainCode, type VenueKind, type LaunchpadRow } from '@voldeck/shared';
import { useLaunchpads } from '@/lib/hooks';

type KindFilter = 'all' | VenueKind;
type ChainFilter = 'all' | ChainCode;

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'launchpad', label: 'Launchpads' },
  { key: 'dex', label: 'DEX' },
  { key: 'all', label: 'All' },
];

export default function Launchpads() {
  const router = useRouter();
  const [kind, setKind] = useState<KindFilter>('launchpad');
  const [chain, setChain] = useState<ChainFilter>('all');
  const { data } = useLaunchpads();

  const all = data?.rows ?? [];
  const chainTotal = (ch: ChainCode) =>
    all.filter((r) => r.chain === ch).reduce((s, r) => s + r.volumeUsd, 0);

  const groups: { ch: ChainCode; rows: LaunchpadRow[] }[] =
    (chain === 'all' ? ORDER : [chain]).map((ch) => ({
      ch,
      rows: all.filter((r) => r.chain === ch && (kind === 'all' || r.kind === kind)),
    }));

  return (
    <div className="panel">
      <div className="phead">
        <span className="ttl">Launchpads</span>
        <span className="subt">memecoin vol per chain · 24h</span>
        <span className="sp"></span>
        <div className="seg">
          <button className={chain === 'all' ? 'on' : ''} onClick={() => setChain('all')}>All chains</button>
          {ORDER.map((c) => (
            <button key={c} className={chain === c ? 'on' : ''} onClick={() => setChain(c)}>{c}</button>
          ))}
        </div>
        <div className="seg">
          {KIND_FILTERS.map((f) => (
            <button key={f.key} className={kind === f.key ? 'on' : ''} onClick={() => setKind(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="lpbody">
        {groups.map(({ ch, rows }) => {
          const total = chainTotal(ch);
          const groupSum = rows.reduce((s, r) => s + r.volumeUsd, 0);
          const max = rows[0]?.volumeUsd ?? 1;
          return (
            <div key={ch}>
              <div className="lpg">
                <span className="dot" style={{ background: CHAINS[ch].color }}></span>
                {CHAINS[ch].name}
                <span className="cs">
                  {rows.length
                    ? fmtUsd(groupSum) + (total > 0 ? ' · ' + ((groupSum / total) * 100).toFixed(0) + '% of chain' : '')
                    : ''}
                </span>
              </div>
              {rows.length ? rows.map((r, i) => (
                <div className="lpr" key={r.venue} onClick={() => router.push('/chain/' + ch)}>
                  <span className="rk">#{i + 1}</span>
                  <span className="nm">{r.venue}</span>
                  <span className="bar"><i style={{ width: (r.volumeUsd / max) * 100 + '%', background: CHAINS[ch].color }}></i></span>
                  <span className="pct">{total > 0 ? ((r.volumeUsd / total) * 100).toFixed(0) + '%' : '--'}</span>
                  <span className="val">{fmtUsd(r.volumeUsd)}</span>
                </div>
              )) : (
                <div className="lpr" style={{ cursor: 'default' }}>
                  <span className="rk"></span>
                  <span className="subt">
                    {kind === 'launchpad' ? 'No launchpad volume tracked' : 'No venue data yet'}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
