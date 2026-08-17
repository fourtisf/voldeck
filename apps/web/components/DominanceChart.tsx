'use client';

/**
 * Dominance history — each chain's share of total volume over time as a
 * stacked 100% area, so rotation between chains reads as widening/narrowing
 * bands. Reuses /api/series data; buckets where no chain has data render as
 * gaps. Chain colors, flat fills, crosshair+tooltip per the app's chart
 * language.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  CHAINS, ORDER, RANGES, type RangeKey, type SeriesPayload,
  fmtUsd, tint,
} from '@voldeck/shared';
import { useSeries } from '@/lib/hooks';
import { useQueryState } from '@/lib/useQueryState';
import { bTime, xLabel, tipTime } from '@/lib/chartTime';

const DOM_RANGES: RangeKey[] = ['24h', '7d', '1m'];

export default function DominanceChart() {
  const [range, setRange] = useQueryState<RangeKey>('dom', '7d', DOM_RANGES);
  const { data } = useSeries(range);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const S = useRef<{
    data: SeriesPayload | undefined; range: RangeKey; hover: number;
    geom: { padL: number; iw: number; n: number; shares: Record<string, (number | null)[]>; totals: number[] } | null;
  }>({ data, range, hover: -1, geom: null });
  S.current.data = data;
  S.current.range = range;

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || cv.offsetParent === null) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const st = S.current;
    const w = cv.clientWidth || 800, h = cv.clientHeight || 240, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; ctx.scale(dpr, dpr);
    const padL = 44, padR = 10, padT = 10, padB = 24;
    const iw = w - padL - padR, ih = h - padT - padB;
    const n = RANGES[st.range].n;

    /* per-bucket share of total; bucket is a gap when every chain is null */
    const totals: number[] = new Array(n).fill(0);
    const shares: Record<string, (number | null)[]> = {};
    for (const c of ORDER) shares[c] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      let any = false, tot = 0;
      for (const c of ORDER) {
        const v = st.data?.series?.[c]?.[i];
        if (v !== null && v !== undefined) { any = true; tot += v; }
      }
      totals[i] = tot;
      if (!any || tot <= 0) continue;
      for (const c of ORDER) {
        const v = st.data?.series?.[c]?.[i];
        shares[c][i] = ((v ?? 0) / tot) * 100;
      }
    }

    const X = (i: number) => padL + (i / (n - 1)) * iw;
    const Y = (v: number) => padT + ih - (v / 100) * ih;
    const font = getComputedStyle(document.body).fontFamily;
    ctx.font = '10px ' + font;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) {
      const v = (100 * g) / 4, y = Y(v);
      ctx.strokeStyle = 'rgba(255,255,255,.04)';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#565e6b'; ctx.fillText(v.toFixed(0) + '%', padL - 8, y);
    }
    const anchorTs = st.data?.anchorTs ?? Date.now();
    const bucketMs = st.data?.bucketMs ?? 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i < n; i += RANGES[st.range].step) {
      ctx.fillStyle = '#565e6b';
      ctx.fillText(xLabel(st.range, bTime(anchorTs, bucketMs, n, i)), X(i), padT + ih + 8);
    }

    /* stacked areas over contiguous non-gap runs */
    let i0 = 0;
    while (i0 < n) {
      while (i0 < n && shares.SOL[i0] === null) i0++;
      let j = i0;
      while (j < n && shares.SOL[j] !== null) j++;
      if (j - i0 >= 2) {
        const cum = new Array(j - i0).fill(0);
        for (const c of ORDER) {
          const prev = cum.slice();
          for (let k = i0; k < j; k++) cum[k - i0] += shares[c][k]!;
          ctx.beginPath(); ctx.moveTo(X(i0), Y(cum[0]));
          for (let k = i0 + 1; k < j; k++) ctx.lineTo(X(k), Y(cum[k - i0]));
          for (let k = j - 1; k >= i0; k--) ctx.lineTo(X(k), Y(prev[k - i0]));
          ctx.closePath(); ctx.fillStyle = tint(CHAINS[c].color, 0.4); ctx.fill();
          ctx.beginPath(); ctx.moveTo(X(i0), Y(cum[0]));
          for (let k = i0 + 1; k < j; k++) ctx.lineTo(X(k), Y(cum[k - i0]));
          ctx.strokeStyle = CHAINS[c].color; ctx.lineWidth = 1.2; ctx.stroke();
        }
      }
      i0 = j;
    }

    if (st.hover >= 0 && st.hover < n && shares.SOL[st.hover] !== null) {
      const x = X(st.hover);
      ctx.strokeStyle = 'rgba(255,255,255,.2)';
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ih); ctx.stroke();
      let s = 0;
      for (const c of ORDER) {
        s += shares[c][st.hover]!;
        const y = Y(s);
        ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.fillStyle = '#0b0d10'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fillStyle = CHAINS[c].color; ctx.fill();
      }
    }
    st.geom = { padL, iw, n, shares, totals };
  }, []);

  const leave = useCallback(() => {
    S.current.hover = -1;
    if (tipRef.current) tipRef.current.style.display = 'none';
    draw();
  }, [draw]);

  const hover = useCallback((clientX: number) => {
    const cv = canvasRef.current, tip = tipRef.current, wrapEl = wrapRef.current;
    const g = S.current.geom;
    if (!cv || !tip || !wrapEl || !g) return;
    const rect = cv.getBoundingClientRect();
    const idx = Math.round(((clientX - rect.left - g.padL) / g.iw) * (g.n - 1));
    if (idx < 0 || idx > g.n - 1 || g.shares.SOL[idx] === null) { leave(); return; }
    S.current.hover = idx;
    const st = S.current;
    const rows = ORDER.map((c) =>
      '<div class="tr"><span class="ld" style="background:' + CHAINS[c].color + '"></span>' + c +
      '<b>' + g.shares[c][idx]!.toFixed(1) + '%</b></div>'
    ).join('');
    tip.innerHTML = '<div class="tt">' + tipTime(bTime(st.data?.anchorTs ?? Date.now(), st.data?.bucketMs ?? 1, g.n, idx)) +
      ' · ' + RANGES[st.range].blbl + ' bucket</div>' + rows +
      '<div class="tot"><span>Total</span><b>' + fmtUsd(g.totals[idx]) + '</b></div>';
    tip.style.display = 'block';
    const wrap = wrapEl.getBoundingClientRect();
    let tx = clientX - wrap.left + 16;
    if (tx + tip.offsetWidth > wrap.width - 10) tx = clientX - wrap.left - tip.offsetWidth - 16;
    tip.style.left = tx + 'px'; tip.style.top = '16px';
    draw();
  }, [draw, leave]);

  useEffect(() => { draw(); }, [data, range, draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  return (
    <div className="panel">
      <div className="phead">
        <span className="ttl">Dominance history</span>
        <span className="subt">share of total volume · UTC</span>
        <span className="sp"></span>
        <div className="legend">
          {ORDER.map((c) => (
            <span key={c} className="lg" style={{ cursor: 'default' }}>
              <span className="ld" style={{ background: CHAINS[c].color }}></span>{c}
            </span>
          ))}
        </div>
        <div className="seg">
          {DOM_RANGES.map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div className="chartwrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ height: 240 }}
          onMouseMove={(e) => hover(e.clientX)}
          onMouseLeave={leave}
          onTouchMove={(e) => { if (e.touches[0]) hover(e.touches[0].clientX); }}
          onTouchEnd={leave}
        />
        <div className="tip" ref={tipRef}></div>
      </div>
    </div>
  );
}
