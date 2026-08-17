'use client';

import { useRouter } from 'next/navigation';
import { CHAINS, fmtUsd, fmtCnt, fmtPct, pctCls } from '@voldeck/shared';
import { useOverview } from '@/lib/hooks';
import FlashNum from './FlashNum';
import Spark from './Spark';

export default function ChainsTable() {
  const router = useRouter();
  const { data } = useOverview();

  return (
    <div className="panel">
      <div className="phead"><span className="ttl">Chains</span><span className="subt">volume Δ by timeframe</span></div>
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th className="l">Chain</th>
              <th>1H</th><th>6H</th><th>24H</th>
              <th>Vol 1H</th><th>Vol 24H</th>
              <th>Share</th><th>Txns 24H</th>
              <th>Last 24H</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data?.chains.map((m) => (
              <tr key={m.chain} className={'crow' + (m.surging ? ' spiking' : '')} onClick={() => router.push('/chain/' + m.chain)}>
                <td className="l">
                  <span className="cname">
                    <span className="dot" style={{ background: CHAINS[m.chain].color }}></span>
                    <span><span className="nm">{CHAINS[m.chain].name}</span> <span className="tk">{m.chain}</span></span>
                    <span className="srg">SURGE</span>
                  </span>
                </td>
                <td className={'pcell ' + pctCls(m.d1)}>{fmtPct(m.d1)}</td>
                <td className={'pcell ' + pctCls(m.d6)}>{fmtPct(m.d6)}</td>
                <td className={'pcell ' + pctCls(m.d24)}>{fmtPct(m.d24)}</td>
                <td><FlashNum value={m.vol1h} text={fmtUsd(m.vol1h)} /></td>
                <td><FlashNum value={m.vol24} text={fmtUsd(m.vol24)} /></td>
                <td>
                  <span className="sharecell">
                    <span className="sub2">{m.share.toFixed(1)}%</span>
                    <span className="sharebar"><i style={{ width: m.share + '%', background: CHAINS[m.chain].color }}></i></span>
                  </span>
                </td>
                <td><span className="sub2">{fmtCnt(m.txns)}</span></td>
                <td><Spark data={m.spark} color={CHAINS[m.chain].color} /></td>
                <td>›</td>
              </tr>
            ))}
            {data && (
              <tr className="trow">
                <td className="l" style={{ fontWeight: 600, color: 'var(--sub)' }}>Total</td>
                <td></td><td></td>
                <td className={'pcell ' + pctCls(data.stats.d24)}>{fmtPct(data.stats.d24)}</td>
                <td><FlashNum value={data.stats.vol1h} text={fmtUsd(data.stats.vol1h)} /></td>
                <td><FlashNum value={data.stats.vol24} text={fmtUsd(data.stats.vol24)} /></td>
                <td></td>
                <td><span className="sub2">{fmtCnt(data.stats.txns24)}</span></td>
                <td></td><td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
