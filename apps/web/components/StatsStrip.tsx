'use client';

import { CHAINS, fmtUsd, fmtCnt, fmtPct, pctCls } from '@voldeck/shared';
import { useOverview } from '@/lib/hooks';
import FlashNum from './FlashNum';

export default function StatsStrip() {
  const { data } = useOverview();
  const s = data?.stats;
  return (
    <div className="stats" id="stats">
      <div className="st">
        <div className="l">Total memecoin vol 24H</div>
        <div className="v">
          {s ? <FlashNum value={s.vol24} text={fmtUsd(s.vol24)} /> : <span className="num">--</span>}
          {s && <span className={'d ' + pctCls(s.d24)}>{fmtPct(s.d24)}</span>}
        </div>
      </div>
      <div className="st">
        <div className="l">Vol 1H</div>
        <div className="v">{s ? <FlashNum value={s.vol1h} text={fmtUsd(s.vol1h)} /> : <span className="num">--</span>}</div>
      </div>
      <div className="st">
        <div className="l">Vol 6H</div>
        <div className="v">{s ? <FlashNum value={s.vol6h} text={fmtUsd(s.vol6h)} /> : <span className="num">--</span>}</div>
      </div>
      <div className="st">
        <div className="l">Txns 24H</div>
        <div className="v"><span>{s ? fmtCnt(s.txns24) : '--'}</span></div>
      </div>
      <div className="st">
        <div className="l">Active pairs</div>
        <div className="v"><span>{s ? fmtCnt(s.pairs) : '--'}</span></div>
      </div>
      <div className="st">
        <div className="l">Volume leader</div>
        <div className="v">
          {s ? (
            <>
              <span className="dot" style={{ background: CHAINS[s.leader.chain].color }}></span>
              {s.leader.chain}
              <span className="d" style={{ color: 'var(--sub)' }}>{s.leader.share.toFixed(1)}%</span>
            </>
          ) : '--'}
        </div>
      </div>
    </div>
  );
}
