'use client';

/**
 * Overview chart — canvas logic ported from the prototype (drawChart,
 * updateBubbleTargets/stepBubbles/drawBubbles/bubbleHover/syncBubbleLoop).
 * Adaptations: data comes from /api/series (nulls = gaps rendered as breaks,
 * not zeros), and view state lives in React while drawing stays imperative
 * through refs.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CHAINS, ORDER, RANGES, RANGE_KEYS, type ChainCode, type RangeKey,
  fmtUsd, fmtPct, tint, niceCeil, clamp, type SeriesPayload,
} from '@voldeck/shared';
import { useSeries } from '@/lib/hooks';
import { useQueryState } from '@/lib/useQueryState';
import { bTime, xLabel, tipTime } from '@/lib/chartTime';

type View = 'lines' | 'stack' | 'bubble';
type Mode = 'usd' | 'pct';

const VIEWS: View[] = ['lines', 'stack', 'bubble'];
const MODES: Mode[] = ['usd', 'pct'];

interface Bub {
  x: number; y: number; vx: number; vy: number; r: number;
  tr: number; share: number; vol: number; delta: number | null;
}

interface ChartState {
  data: SeriesPayload | undefined;
  range: RangeKey;
  view: View;
  mode: Mode;
  visSet: Set<ChainCode>;
  hoverIdx: number;
  hoverB: ChainCode | null;
  bub: Partial<Record<ChainCode, Bub>>;
  bubTargetsAt: number;
  raf: number | null;
  geom: { padL: number; iw: number; n: number; data: Partial<Record<ChainCode, (number | null)[]>>; pctMode: boolean; bubble?: boolean } | null;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function indexed(arr: (number | null)[]): (number | null)[] {
  let base = 0;
  for (const v of arr) { if (v !== null && v > 0) { base = v; break; } }
  if (!base) base = 1;
  return arr.map((v) => (v === null ? null : (v / base - 1) * 100));
}

export default function VolumeChart() {
  const router = useRouter();
  const [range, setRange] = useQueryState<RangeKey>('range', '24h', RANGE_KEYS);
  const [view, setView] = useQueryState<View>('view', 'lines', VIEWS);
  const [mode, setMode] = useQueryState<Mode>('mode', 'usd', MODES);
  const [visArr, setVisArr] = useState<ChainCode[]>([...ORDER]);
  const { data } = useSeries(range);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const S = useRef<ChartState>({
    data: undefined, range, view, mode, visSet: new Set(ORDER),
    hoverIdx: -1, hoverB: null, bub: {}, bubTargetsAt: 0, raf: null, geom: null,
  });
  S.current.data = data;
  S.current.range = range;
  S.current.view = view;
  S.current.mode = mode;
  S.current.visSet = new Set(visArr);

  const reducedMotion = useRef(false);
  useEffect(() => {
    reducedMotion.current = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const seriesOf = useCallback((ch: ChainCode): (number | null)[] => {
    const st = S.current;
    const n = RANGES[st.range].n;
    const arr = st.data?.series?.[ch];
    if (!arr) return new Array(n).fill(null);
    return arr.length === n ? arr : [...new Array(Math.max(0, n - arr.length)).fill(null), ...arr].slice(-n);
  }, []);

  /* ---------- bubbles (ported) ---------- */

  const updateBubbleTargets = useCallback((w: number, h: number) => {
    const st = S.current;
    const vs = ORDER.filter((c) => st.visSet.has(c));
    let tot = 0;
    const vols: Partial<Record<ChainCode, number>> = {};
    for (const c of vs) {
      vols[c] = seriesOf(c).reduce((s: number, v) => s + (v ?? 0), 0);
      tot += vols[c]!;
    }
    const k = Math.sqrt((0.32 * w * h) / (Math.PI * 100));
    for (const c of vs) {
      const share = tot > 0 ? (vols[c]! / tot) * 100 : 0;
      if (!st.bub[c]) st.bub[c] = { x: w / 2 + rnd(-70, 70), y: h / 2 + rnd(-40, 40), vx: rnd(-0.2, 0.2), vy: rnd(-0.2, 0.2), r: 12, tr: 12, share: 0, vol: 0, delta: null };
      const b = st.bub[c]!;
      b.share = share;
      b.vol = vols[c]!;
      b.delta = st.data?.deltas?.[c] ?? null;
      b.tr = clamp(k * Math.sqrt(share), 17, Math.min(w, h) / 2 - 12);
    }
  }, [seriesOf]);

  const stepBubbles = useCallback((w: number, h: number) => {
    const st = S.current;
    const vs = ORDER.filter((c) => st.visSet.has(c) && st.bub[c]);
    for (const c of vs) {
      const b = st.bub[c]!;
      b.r += (b.tr - b.r) * 0.12;
      b.vx += (w / 2 - b.x) * 0.0005 + (reducedMotion.current ? 0 : rnd(-0.02, 0.02));
      b.vy += (h / 2 - b.y) * 0.0007 + (reducedMotion.current ? 0 : rnd(-0.02, 0.02));
      b.vx *= 0.95; b.vy *= 0.95;
      b.x += b.vx; b.y += b.vy;
    }
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a = st.bub[vs[i]]!, b = st.bub[vs[j]]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1, min = a.r + b.r + 7;
      if (d < min) {
        const push = (min - d) / 2, ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      }
    }
    for (const c of vs) {
      const b = st.bub[c]!;
      b.x = clamp(b.x, b.r + 8, w - b.r - 8);
      b.y = clamp(b.y, b.r + 8, h - b.r - 8);
    }
  }, []);

  const drawBubbles = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const st = S.current;
    const now = performance.now();
    if (now - st.bubTargetsAt > 700) { updateBubbleTargets(w, h); st.bubTargetsAt = now; }
    stepBubbles(w, h);
    const font = getComputedStyle(document.body).fontFamily;
    const vs = ORDER.filter((c) => st.visSet.has(c) && st.bub[c]).sort((a, b) => st.bub[b]!.r - st.bub[a]!.r);
    for (const c of vs) {
      const b = st.bub[c]!, col = CHAINS[c].color, hov = st.hoverB === c;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = tint(col, hov ? 0.22 : 0.12); ctx.fill();
      ctx.lineWidth = hov ? 2.2 : 1.5; ctx.strokeStyle = hov ? col : tint(col, 0.75); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (b.r >= 62) {
        ctx.fillStyle = '#fff'; ctx.font = '600 13px ' + font;
        ctx.fillText(c, b.x, b.y - b.r * 0.42);
        ctx.font = '600 ' + Math.min(21, Math.round(b.r * 0.3)) + 'px ' + font;
        ctx.fillText(b.share.toFixed(1) + '%', b.x, b.y - 2);
        ctx.fillStyle = '#8b93a1'; ctx.font = '500 11px ' + font;
        ctx.fillText(fmtUsd(b.vol), b.x, b.y + b.r * 0.3);
        if (b.delta != null) {
          ctx.fillStyle = b.delta >= 0 ? '#0ecb81' : '#f6465d'; ctx.font = '600 11px ' + font;
          ctx.fillText(fmtPct(b.delta), b.x, b.y + b.r * 0.3 + 15);
        }
      } else if (b.r >= 34) {
        ctx.fillStyle = '#fff'; ctx.font = '600 12px ' + font;
        ctx.fillText(c, b.x, b.y - 9);
        ctx.font = '600 14px ' + font;
        ctx.fillText(b.share.toFixed(1) + '%', b.x, b.y + 9);
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = '600 ' + Math.max(9, Math.min(12, Math.round(b.r * 0.5))) + 'px ' + font;
        ctx.fillText(c, b.x, b.y);
      }
    }
  }, [stepBubbles, updateBubbleTargets]);

  /* ---------- main draw (ported) ---------- */

  const drawChart = useCallback(() => {
    const chart = canvasRef.current;
    if (!chart || chart.offsetParent === null) return;
    const ctx = chart.getContext('2d');
    if (!ctx) return;
    const st = S.current;
    const w = chart.clientWidth || 800, h = chart.clientHeight || 300, dpr = window.devicePixelRatio || 1;
    chart.width = w * dpr; chart.height = h * dpr; ctx.scale(dpr, dpr);
    if (st.view === 'bubble') { drawBubbles(ctx, w, h); st.geom = { padL: 0, iw: 0, n: 0, data: {}, pctMode: false, bubble: true }; return; }
    const padL = 54, padR = 10, padT = 10, padB = 24;
    const iw = w - padL - padR, ih = h - padT - padB;
    const n = RANGES[st.range].n;
    const vs = ORDER.filter((c) => st.visSet.has(c));
    const pctMode = st.view === 'lines' && st.mode === 'pct';
    const data: Partial<Record<ChainCode, (number | null)[]>> = {};
    for (const c of vs) data[c] = pctMode ? indexed(seriesOf(c)) : seriesOf(c);

    /* y scale */
    let ymin = 0, ymax: number;
    if (pctMode) {
      let mn = 0, mx = 0;
      for (const c of vs) for (const v of data[c]!) { if (v === null) continue; if (v < mn) mn = v; if (v > mx) mx = v; }
      ymax = niceCeil(Math.max(mx * 1.08, 5));
      ymin = mn < 0 ? -niceCeil(Math.max(-mn * 1.08, 5)) : 0;
    } else {
      let raw = 0;
      if (st.view === 'stack') {
        for (let i = 0; i < n; i++) { let s = 0; for (const c of vs) s += data[c]![i] ?? 0; raw = Math.max(raw, s); }
      } else {
        for (const c of vs) for (const v of data[c]!) raw = Math.max(raw, v ?? 0);
      }
      ymax = niceCeil(raw * 1.06);
    }
    const X = (i: number) => padL + (i / (n - 1)) * iw;
    const Y = (v: number) => padT + ih - ((v - ymin) / (ymax - ymin)) * ih;
    const font = getComputedStyle(document.body).fontFamily;
    ctx.font = '10px ' + font;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) {
      const v = ymin + ((ymax - ymin) * g) / 4, y = Y(v);
      ctx.strokeStyle = Math.abs(v) < 1e-9 && pctMode ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.04)';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#565e6b';
      ctx.fillText(pctMode ? (v > 0 ? '+' : '') + v.toFixed(0) + '%' : fmtUsd(v), padL - 8, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const anchorTs = st.data?.anchorTs ?? Date.now();
    const bucketMs = st.data?.bucketMs ?? 1;
    for (let i = 0; i < n; i += RANGES[st.range].step) {
      ctx.fillStyle = '#565e6b';
      ctx.fillText(xLabel(st.range, bTime(anchorTs, bucketMs, n, i)), X(i), padT + ih + 8);
    }
    if (st.view === 'stack') {
      const cum = new Array(n).fill(0);
      for (const c of vs) {
        const prev = cum.slice();
        for (let i = 0; i < n; i++) cum[i] += data[c]![i] ?? 0;
        ctx.beginPath(); ctx.moveTo(X(0), Y(cum[0]));
        for (let i = 1; i < n; i++) ctx.lineTo(X(i), Y(cum[i]));
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(prev[i]));
        ctx.closePath(); ctx.fillStyle = tint(CHAINS[c].color, 0.28); ctx.fill();
        ctx.beginPath(); ctx.moveTo(X(0), Y(cum[0]));
        for (let i = 1; i < n; i++) ctx.lineTo(X(i), Y(cum[i]));
        ctx.strokeStyle = CHAINS[c].color; ctx.lineWidth = 1.2; ctx.stroke();
      }
    } else {
      for (const c of vs) {
        const arr = data[c]!;
        /* draw contiguous non-null runs; gaps stay open (no fake zeros) */
        let i = 0;
        let lastIdx = -1;
        while (i < n) {
          while (i < n && arr[i] === null) i++;
          let j = i;
          while (j < n && arr[j] !== null) j++;
          if (j > i) {
            if (!pctMode) {
              const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
              grad.addColorStop(0, tint(CHAINS[c].color, 0.08)); grad.addColorStop(1, 'rgba(0,0,0,0)');
              ctx.beginPath(); ctx.moveTo(X(i), Y(arr[i]!));
              for (let k2 = i + 1; k2 < j; k2++) ctx.lineTo(X(k2), Y(arr[k2]!));
              ctx.lineTo(X(j - 1), padT + ih); ctx.lineTo(X(i), padT + ih); ctx.closePath();
              ctx.fillStyle = grad; ctx.fill();
            }
            ctx.beginPath(); ctx.moveTo(X(i), Y(arr[i]!));
            for (let k2 = i + 1; k2 < j; k2++) ctx.lineTo(X(k2), Y(arr[k2]!));
            ctx.strokeStyle = CHAINS[c].color; ctx.lineWidth = 1.5; ctx.stroke();
            lastIdx = j - 1;
          }
          i = j;
        }
        if (lastIdx >= 0) {
          ctx.beginPath(); ctx.arc(X(lastIdx), Y(data[c]![lastIdx]!), 2.2, 0, Math.PI * 2);
          ctx.fillStyle = CHAINS[c].color; ctx.fill();
        }
      }
    }
    if (st.hoverIdx >= 0 && st.hoverIdx < n) {
      const x = X(st.hoverIdx);
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ih); ctx.stroke();
      const pts: [ChainCode, number][] = [];
      if (st.view === 'stack') {
        let s = 0;
        for (const c of vs) { s += data[c]![st.hoverIdx] ?? 0; pts.push([c, Y(s)]); }
      } else {
        for (const c of vs) { const v = data[c]![st.hoverIdx]; if (v !== null) pts.push([c, Y(v)]); }
      }
      for (const [c, y] of pts) {
        ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.fillStyle = '#0b0d10'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fillStyle = CHAINS[c].color; ctx.fill();
      }
    }
    st.geom = { padL, iw, n, data, pctMode };
  }, [drawBubbles, seriesOf]);

  /* ---------- hover (ported) ---------- */

  const bubbleHover = useCallback((clientX: number, clientY: number) => {
    const chart = canvasRef.current, tip = tipRef.current, wrapEl = wrapRef.current;
    if (!chart || !tip || !wrapEl) return;
    const st = S.current;
    const rect = chart.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let hit: ChainCode | null = null;
    for (const c of ORDER) {
      if (!st.visSet.has(c) || !st.bub[c]) continue;
      const b = st.bub[c]!, dx = x - b.x, dy = y - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) { if (!hit || st.bub[hit]!.r > b.r) hit = c; }
    }
    st.hoverB = hit;
    chart.style.cursor = hit ? 'pointer' : 'default';
    if (hit) {
      const b = st.bub[hit]!;
      tip.innerHTML =
        '<div class="tt">' + CHAINS[hit].name + ' · ' + st.range.toUpperCase() + ' window</div>' +
        '<div class="tr"><span class="ld" style="background:' + CHAINS[hit].color + '"></span>Share<b>' + b.share.toFixed(1) + '%</b></div>' +
        '<div class="tr"><span class="ld" style="background:transparent"></span>Volume<b>' + fmtUsd(b.vol) + '</b></div>' +
        (b.delta != null ? '<div class="tr"><span class="ld" style="background:transparent"></span>Δ vs prev<b style="color:var(--' + (b.delta >= 0 ? 'up' : 'down') + ')">' + fmtPct(b.delta) + '</b></div>' : '') +
        '<div class="tot"><span>Click bubble</span><b style="color:var(--sub);font-weight:500">open detail</b></div>';
      tip.style.display = 'block';
      const wrap = wrapEl.getBoundingClientRect();
      let tx = clientX - wrap.left + 16;
      if (tx + tip.offsetWidth > wrap.width - 10) tx = clientX - wrap.left - tip.offsetWidth - 16;
      tip.style.left = tx + 'px'; tip.style.top = clamp(clientY - wrap.top - 10, 8, 200) + 'px';
    } else tip.style.display = 'none';
  }, []);

  const ovHover = useCallback((clientX: number, clientY: number) => {
    const chart = canvasRef.current, tip = tipRef.current, wrapEl = wrapRef.current;
    if (!chart || !tip || !wrapEl) return;
    const st = S.current;
    if (st.view === 'bubble') { bubbleHover(clientX, clientY); return; }
    const g = st.geom;
    if (!g || g.bubble) return;
    const rect = chart.getBoundingClientRect();
    const x = clientX - rect.left;
    const idx = Math.round(((x - g.padL) / g.iw) * (g.n - 1));
    if (idx < 0 || idx > g.n - 1) { ovLeave(); return; }
    st.hoverIdx = idx;
    let tot = 0, rows = '';
    for (const c of ORDER) {
      if (!st.visSet.has(c)) continue;
      const raw = seriesOf(c)[idx];
      let disp: string;
      if (g.pctMode) {
        const v = g.data[c]?.[idx] ?? null;
        disp = v === null ? '—' : fmtPct(v);
      } else {
        disp = raw === null ? '—' : fmtUsd(raw);
      }
      tot += raw ?? 0;
      rows += '<div class="tr"><span class="ld" style="background:' + CHAINS[c].color + '"></span>' + c + '<b>' + disp + '</b></div>';
    }
    const anchorTs = st.data?.anchorTs ?? Date.now();
    const bucketMs = st.data?.bucketMs ?? 1;
    tip.innerHTML =
      '<div class="tt">' + tipTime(bTime(anchorTs, bucketMs, g.n, idx)) + ' · ' + RANGES[st.range].blbl + ' bucket</div>' + rows +
      '<div class="tot"><span>Total</span><b>' + fmtUsd(tot) + '</b></div>';
    tip.style.display = 'block';
    const wrap = wrapEl.getBoundingClientRect();
    let tx = clientX - wrap.left + 16;
    if (tx + tip.offsetWidth > wrap.width - 10) tx = clientX - wrap.left - tip.offsetWidth - 16;
    tip.style.left = tx + 'px'; tip.style.top = '16px';
    drawChart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbleHover, drawChart, seriesOf]);

  const ovLeave = useCallback(() => {
    const st = S.current, tip = tipRef.current;
    if (st.view === 'bubble') { st.hoverB = null; if (tip) tip.style.display = 'none'; return; }
    st.hoverIdx = -1;
    if (tip) tip.style.display = 'none';
    drawChart();
  }, [drawChart]);

  /* ---------- bubble RAF loop (ported syncBubbleLoop) ---------- */

  useEffect(() => {
    const st = S.current;
    if (view !== 'bubble') {
      if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; }
      return;
    }
    const frame = () => {
      st.raf = null;
      if (S.current.view !== 'bubble' || !canvasRef.current || canvasRef.current.offsetParent === null) return;
      drawChart();
      st.raf = requestAnimationFrame(frame);
    };
    st.bubTargetsAt = 0;
    st.raf = requestAnimationFrame(frame);
    return () => { if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; } };
  }, [view, drawChart]);

  /* redraw on data / control changes; resize */
  useEffect(() => {
    if (S.current.view !== 'bubble') drawChart();
  }, [data, range, view, mode, visArr, drawChart]);
  useEffect(() => {
    const onResize = () => drawChart();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawChart]);

  const toggleChain = (c: ChainCode) => {
    setVisArr((prev) => {
      if (prev.includes(c)) return prev.length > 1 ? prev.filter((x) => x !== c) : prev;
      return [...ORDER].filter((x) => prev.includes(x) || x === c);
    });
    S.current.bubTargetsAt = 0;
  };

  const subTxt = view === 'bubble'
    ? 'share of ' + range.toUpperCase() + ' volume'
    : RANGES[range].blbl + ' buckets · UTC';

  return (
    <div className="panel">
      <div className="phead">
        <span className="ttl">Volume per chain</span>
        <span className="subt">{subTxt}</span>
        <span className="sp"></span>
        <div className="legend">
          {ORDER.map((c) => (
            <button key={c} className={'lg' + (visArr.includes(c) ? '' : ' off')} onClick={() => toggleChain(c)}>
              <span className="ld" style={{ background: CHAINS[c].color }}></span>{c}
            </button>
          ))}
        </div>
        <div className={'seg' + (view !== 'lines' ? ' dis' : '')}>
          <button className={mode === 'usd' ? 'on' : ''} onClick={() => setMode('usd')}>$</button>
          <button className={mode === 'pct' ? 'on' : ''} onClick={() => setMode('pct')}>%</button>
        </div>
        <div className="seg">
          {VIEWS.map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => {
              setView(v);
              const st = S.current;
              st.hoverIdx = -1; st.hoverB = null; st.bubTargetsAt = 0;
              if (tipRef.current) tipRef.current.style.display = 'none';
              if (canvasRef.current) canvasRef.current.style.cursor = v === 'bubble' ? 'default' : 'crosshair';
            }}>
              {v === 'lines' ? 'Lines' : v === 'stack' ? 'Stacked' : 'Bubbles'}
            </button>
          ))}
        </div>
        <div className="seg">
          {RANGE_KEYS.map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => {
              setRange(r);
              S.current.hoverIdx = -1; S.current.bubTargetsAt = 0;
            }}>
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="chartwrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          onMouseMove={(e) => ovHover(e.clientX, e.clientY)}
          onMouseLeave={ovLeave}
          onTouchMove={(e) => { if (e.touches[0]) ovHover(e.touches[0].clientX, e.touches[0].clientY); }}
          onTouchEnd={ovLeave}
          onClick={() => { const st = S.current; if (st.view === 'bubble' && st.hoverB) router.push('/chain/' + st.hoverB); }}
        />
        <div className="tip" ref={tipRef}></div>
      </div>
    </div>
  );
}
