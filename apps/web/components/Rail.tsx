'use client';

import { useRouter } from 'next/navigation';
import { CHAINS, fmtUsd, fmtPp, pctCls, type AlertType } from '@voldeck/shared';
import { useOverview, useAlerts } from '@/lib/hooks';
import { utcClock } from '@/lib/chartTime';

function Cdot({ ch }: { ch: keyof typeof CHAINS }) {
  return <span className="dot" style={{ background: CHAINS[ch].color }}></span>;
}

export function alertMsgCls(type: AlertType): string {
  return type === 'fade' ? 'down' : type === 'rotation' ? 'blue' : 'up';
}

export default function Rail() {
  const router = useRouter();
  const { data: ov } = useOverview();
  const { data: al } = useAlerts();
  const go = (ch: string) => router.push('/chain/' + ch);

  return (
    <div className="rail">
      <div className="panel">
        <div className="phead"><span className="ttl">Dominance</span><span className="subt">share 24h</span></div>
        <div className="railbody" id="dom">
          {ov?.dominance.map((d) => (
            <div className="df" key={d.chain} onClick={() => go(d.chain)}>
              <div className="r1">
                <span className="l"><Cdot ch={d.chain} />{d.chain}</span>
                <span className="r">{d.share.toFixed(1)}%<span>{fmtUsd(d.vol24)}</span></span>
              </div>
              <div className="bar"><i style={{ width: d.share + '%', background: CHAINS[d.chain].color }}></i></div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="phead"><span className="ttl">Rotation</span><span className="subt">Δ vs prev 24h</span></div>
        <div id="rot">
          {ov?.rotation.map((r) => (
            <div className="rr" key={r.chain} onClick={() => go(r.chain)}>
              <Cdot ch={r.chain} /><b>{r.chain}</b>
              <span className="was">{r.sharePrev.toFixed(1)}% → {r.share.toFixed(1)}%</span>
              <span className={'pp ' + pctCls(r.rot)}>{fmtPp(r.rot)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="phead"><span className="ttl">Flow alerts</span><span className="subt" id="alCnt">{al?.alerts.length ?? 0}</span></div>
        <div className="feed" id="feed">
          {al?.alerts.map((a) => (
            <div className="al" key={a.id} onClick={() => go(a.chain)}>
              <span className="t">{utcClock(a.ts)}</span>
              <Cdot ch={a.chain} /><b>{a.chain}</b>
              <span className={'msg ' + alertMsgCls(a.type)}>{a.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
