'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CHAINS, RANGES, RANGE_KEYS, type ChainCode, type RangeKey,
  fmtUsd, fmtCnt, fmtPct, fmtPp, pctCls,
} from '@voldeck/shared';
import { useChainDetail, useChainSeries, useAlerts } from '@/lib/hooks';
import { utcClock } from '@/lib/chartTime';
import FlashNum from './FlashNum';
import DetailBars from './DetailBars';
import Heat from './Heat';
import { alertMsgCls } from './Rail';

const p2 = (n: number) => String(n).padStart(2, '0');

export default function DetailScreen({ code }: { code: ChainCode }) {
  const router = useRouter();
  const [range, setRange] = useState<RangeKey>('24h');
  const { data: d } = useChainDetail(code);
  const { data: series } = useChainSeries(code, range);
  const { data: al } = useAlerts(code);
  const info = CHAINS[code];

  /* Escape on detail → back to overview (prototype behavior) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') router.push('/'); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [router]);

  const s = d?.stats;
  const chainAlerts = (al?.alerts ?? []).slice(0, 8);

  const tiles: [string, string, string | null, string | null][] = s ? [
    ['Vol 5M', fmtUsd(s.vol5m), null, null],
    ['Vol 1H', fmtUsd(s.vol1h), fmtPct(s.d1), pctCls(s.d1)],
    ['Vol 6H', fmtUsd(s.vol6h), fmtPct(s.d6), pctCls(s.d6)],
    ['Vol 24H', fmtUsd(s.vol24), fmtPct(s.d24), pctCls(s.d24)],
    ['Txns 24H', fmtCnt(s.txns24), null, null],
    ['Peak hour 24H', p2(s.peakHourUtc) + ':00 UTC', fmtUsd(s.peakHourVol), null],
    ['Avg trade', fmtUsd(s.avgTrade), null, null],
    ['Active pairs', fmtCnt(s.pairs), null, null],
  ] : [];

  return (
    <>
      <button className="back" onClick={() => router.push('/')}>← Overview</button>

      <div className="panel">
        <div className="dhead">
          <span className="dot" style={{ background: info.color }}></span>
          <div>
            <div className="nm">{info.name}</div>
            <div className="full">{info.full}</div>
          </div>
          <span className="tag blue">{d ? '#' + d.rank + ' by volume' : '--'}</span>
          <span className="sp"></span>
          <div className="dmeta">
            <div className="dm">
              <div className="l">Vol 24H</div>
              <div className="v">{s ? <FlashNum value={s.vol24} text={fmtUsd(s.vol24)} /> : '--'}</div>
            </div>
            <div className="dm">
              <div className="l">Δ 24H</div>
              <div className="v">{s ? <span className={pctCls(s.d24)}>{fmtPct(s.d24)}</span> : '--'}</div>
            </div>
            <div className="dm">
              <div className="l">Share 24H</div>
              <div className="v">{s ? s.share.toFixed(1) + '%' : '--'}</div>
            </div>
            <div className="dm">
              <div className="l">Rotation</div>
              <div className="v">{s ? <span className={pctCls(s.rot)}>{fmtPp(s.rot)}</span> : '--'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="phead">
          <span className="ttl">{info.name} volume</span>
          <span className="subt">{RANGES[range].blbl} buckets</span>
          <span className="sp"></span>
          <div className="seg">
            {RANGE_KEYS.map((r) => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <DetailBars code={code} range={range} data={series} />
      </div>

      <div className="panel">
        <div className="phead"><span className="ttl">Volume by venue</span><span className="subt">24h · DEX &amp; launchpads</span></div>
        <div className="venue">
          {d?.venues.length ? d.venues.map((v) => (
            <div className="vr" key={v.name}>
              <span className="nm">{v.name}</span>
              <span className="bar"><i style={{ width: (v.share * 100) + '%', background: info.color }}></i></span>
              <span className="pct">{(v.share * 100).toFixed(0)}%</span>
              <span className="val">{fmtUsd(v.volumeUsd)}</span>
            </div>
          )) : <div className="vr"><span className="subt">No venue data yet</span></div>}
        </div>
      </div>

      <div className="panel">
        <div className="phead"><span className="ttl">Stats</span></div>
        <div className="dstats">
          {tiles.map((x) => (
            <div className="dst" key={x[0]}>
              <div className="t">{x[0]}</div>
              <div className="v">{x[1]}</div>
              {x[2] && (
                <div className={'d ' + (x[3] || '')} style={x[3] ? undefined : { color: 'var(--sub)' }}>{x[2]}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="panel dheat">
        <div className="phead"><span className="ttl">Hourly heat</span><span className="subt">last 24h · UTC</span></div>
        {d ? (
          <Heat rows={[{ ch: code, cells: d.heat }]} anchorTs={d.heatAnchorTs} showLabels={false} />
        ) : (
          <div className="heatbody"><span className="subt">Loading…</span></div>
        )}
      </div>

      <div className="panel">
        <div className="phead"><span className="ttl">Alerts</span></div>
        <div>
          {chainAlerts.length ? chainAlerts.map((a) => (
            <div className="al" style={{ cursor: 'default' }} key={a.id}>
              <span className="t">{utcClock(a.ts)}</span>
              <span className="dot" style={{ background: info.color }}></span>
              <b>{a.chain}</b>
              <span className={'msg ' + alertMsgCls(a.type)}>{a.message}</span>
            </div>
          )) : (
            <div className="al" style={{ cursor: 'default' }}>
              <span className="subt">No alerts yet for this chain</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
