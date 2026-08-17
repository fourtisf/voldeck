'use client';

/**
 * Launchpad wars — share of a chain's launchpad volume over time, one line
 * per launchpad, so overtakes (LetsBonk vs Pump.fun etc.) are visible as
 * crossing lines. Hourly VenueVolume data: 24H = 1h buckets, 7D = 4h.
 *
 * Launchpad line colors come from a CVD-validated categorical palette
 * (distinct from the reserved chain colors) assigned per venue on first
 * appearance and never reassigned, so a venue keeps its color across
 * range/chain switches.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAINS, ORDER, DAYS, MONTHS, type ChainCode, type LpRangeKey,
  niceCeil, type LaunchpadSeriesPayload,
} from '@voldeck/shared';
import { useLaunchpadSeries } from '@/lib/hooks';
import { useQueryState } from '@/lib/useQueryState';
import { bTime, tipTime } from '@/lib/chartTime';

const LP_PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
const lpColorMap = new Map<string, string>();
function lpColor(name: string): string {
  if (!lpColorMap.has(name)) lpColorMap.set(name, LP_PALETTE[lpColorMap.size % LP_PALETTE.length]);
  return lpColorMap.get(name)!;
}

const p2 = (n: number) => String(n).padStart(2, '0');
const LP_RANGES: LpRangeKey[] = ['24h', '7d', '30d'];
/* points per range: 24, 42, 60 — label every Nth point */
const LP_STEP: Record<LpRangeKey, number> = { '24h': 4, '7d': 6, '30d': 8 };

function lpXLabel(range: LpRangeKey, ts: number): string {
  const d = new Date(ts);
  if (range === '24h') return p2(d.getUTCHours()) + ':00';
  if (range === '7d') return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate();
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

export default function LaunchpadWars() {
  const [chain, setChain] = useQueryState<ChainCode>('wc', 'SOL', ORDER);
  const [range, setRange] = useQueryState<LpRangeKey>('wr', '7d', LP_RANGES);
  const { data } = useLaunchpadSeries(chain, range);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const S = useRef<{
    data: LaunchpadSeriesPayload | undefined; range: LpRangeKey; hidden: Set<string>; hover: number;
    geom: { padL: number; iw: number; n: number } | null;
  }>({ data, range, hidden, hover: -1, geom: null });
  S.current.data = data;
  S.current.range = range;
  S.current.hidden = hidden;

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
    const venues = (st.data?.venues ?? []).filter((v) => !st.hidden.has(v.name));
    const n = venues[0]?.shares.length ?? (st.range === '24h' ? 24 : st.range === '7d' ? 42 : 60);

    let mx = 0;
    for (const v of venues) for (const s of v.shares) if (s !== null && s > mx) mx = s;
    const ymax = Math.min(100, niceCeil(Math.max(mx * 1.08, 10)));
    const X = (i: number) => padL + (i / (n - 1)) * iw;
    const Y = (v: number) => padT + ih - (v / ymax) * ih;
    const font = getComputedStyle(document.body).fontFamily;

    ctx.font = '10px ' + font;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) {
      const v = (ymax * g) / 4, y = Y(v);
      ctx.strokeStyle = 'rgba(255,255,255,.04)';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#565e6b'; ctx.fillText(v.toFixed(0) + '%', padL - 8, y);
    }
    const anchorTs = st.data?.anchorTs ?? Date.now();
    const bucketMs = st.data?.bucketMs ?? 3600_000;
    const step = LP_STEP[st.range];
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i < n; i += step) {
      ctx.fillStyle = '#565e6b';
      ctx.fillText(lpXLabel(st.range, bTime(anchorTs, bucketMs, n, i)), X(i), padT + ih + 8);
    }
    for (const v of venues) {
      const col = lpColor(v.name);
      let i = 0, lastIdx = -1;
      while (i < n) {
        while (i < n && v.shares[i] === null) i++;
        let j = i;
        while (j < n && v.shares[j] !== null) j++;
        if (j > i) {
          ctx.beginPath(); ctx.moveTo(X(i), Y(v.shares[i]!));
          for (let k = i + 1; k < j; k++) ctx.lineTo(X(k), Y(v.shares[k]!));
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
          lastIdx = j - 1;
        }
        i = j;
      }
      if (lastIdx >= 0) {
        ctx.beginPath(); ctx.arc(X(lastIdx), Y(v.shares[lastIdx]!), 2.2, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
      }
    }
    if (st.hover >= 0 && st.hover < n) {
      const x = X(st.hover);
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ih); ctx.stroke();
      for (const v of venues) {
        const s = v.shares[st.hover];
        if (s === null) continue;
        ctx.beginPath(); ctx.arc(x, Y(s), 3.6, 0, Math.PI * 2); ctx.fillStyle = '#0b0d10'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, Y(s), 2.6, 0, Math.PI * 2); ctx.fillStyle = lpColor(v.name); ctx.fill();
      }
    }
    st.geom = { padL, iw, n };
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
    if (idx < 0 || idx > g.n - 1) { leave(); return; }
    S.current.hover = idx;
    const st = S.current;
    const venues = (st.data?.venues ?? []).filter((v) => !st.hidden.has(v.name));
    const rows = venues.map((v) => {
      const s = v.shares[idx];
      return '<div class="tr"><span class="ld" style="background:' + lpColor(v.name) + '"></span>' + v.name +
        '<b>' + (s === null ? '—' : s.toFixed(1) + '%') + '</b></div>';
    }).join('');
    tip.innerHTML = '<div class="tt">' + tipTime(bTime(st.data?.anchorTs ?? Date.now(), st.data?.bucketMs ?? 1, g.n, idx)) +
      ' · share of launchpad vol</div>' + rows;
    tip.style.display = 'block';
    const wrap = wrapEl.getBoundingClientRect();
    let tx = clientX - wrap.left + 16;
    if (tx + tip.offsetWidth > wrap.width - 10) tx = clientX - wrap.left - tip.offsetWidth - 16;
    tip.style.left = tx + 'px'; tip.style.top = '16px';
    draw();
  }, [draw, leave]);

  useEffect(() => { draw(); }, [data, range, chain, hidden, draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  const toggle = (name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="panel">
      <div className="phead">
        <span className="ttl">Launchpad wars</span>
        <span className="subt">share of {CHAINS[chain].name} launchpad vol · UTC</span>
        <span className="sp"></span>
        <div className="legend">
          {(data?.venues ?? []).map((v) => (
            <button key={v.name} className={'lg' + (hidden.has(v.name) ? ' off' : '')} onClick={() => toggle(v.name)}>
              <span className="ld" style={{ background: lpColor(v.name) }}></span>{v.name}
            </button>
          ))}
        </div>
        <div className="seg">
          {ORDER.map((c) => (
            <button key={c} className={chain === c ? 'on' : ''} onClick={() => { setChain(c); setHidden(new Set()); }}>{c}</button>
          ))}
        </div>
        <div className="seg">
          {LP_RANGES.map((r) => (
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
