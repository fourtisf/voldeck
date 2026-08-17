'use client';

/** Chain detail bar chart + MA line — drawBars/dtHover ported from the prototype. */
import { useCallback, useEffect, useRef } from 'react';
import {
  CHAINS, RANGES, type ChainCode, type RangeKey,
  fmtUsd, niceCeil, type SeriesPayload,
} from '@voldeck/shared';
import { bTime, xLabel, tipTime } from '@/lib/chartTime';

export default function DetailBars({
  code, range, data,
}: {
  code: ChainCode;
  range: RangeKey;
  data: SeriesPayload | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const S = useRef<{
    data: SeriesPayload | undefined; range: RangeKey; hover: number;
    geom: { padL: number; iw: number; n: number; data: (number | null)[] } | null;
  }>({ data, range, hover: -1, geom: null });
  S.current.data = data;
  S.current.range = range;

  const drawBars = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || cv.offsetParent === null) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const st = S.current;
    const color = CHAINS[code].color;
    const w = cv.clientWidth || 800, h = cv.clientHeight || 270, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; ctx.scale(dpr, dpr);
    const padL = 54, padR = 10, padT = 10, padB = 24;
    const iw = w - padL - padR, ih = h - padT - padB;
    const n = RANGES[st.range].n;
    const raw = st.data?.series?.[code] ?? new Array(n).fill(null);
    const series: (number | null)[] = raw.length === n ? raw : [...new Array(Math.max(0, n - raw.length)).fill(null), ...raw].slice(-n);
    const vals = series.filter((v): v is number => v !== null);
    const ymax = niceCeil((vals.length ? Math.max(...vals) : 1) * 1.06);
    const bw = iw / n;
    const Y = (v: number) => padT + ih - (v / ymax) * ih;
    const font = getComputedStyle(document.body).fontFamily;
    ctx.font = '10px ' + font;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) {
      const v = (ymax * g) / 4, y = Y(v);
      ctx.strokeStyle = 'rgba(255,255,255,.04)';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#565e6b'; ctx.fillText(fmtUsd(v), padL - 8, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const anchorTs = st.data?.anchorTs ?? Date.now();
    const bucketMs = st.data?.bucketMs ?? 1;
    for (let i = 0; i < n; i += RANGES[st.range].step) {
      ctx.fillStyle = '#565e6b';
      ctx.fillText(xLabel(st.range, bTime(anchorTs, bucketMs, n, i)), padL + i * bw + bw / 2, padT + ih + 8);
    }
    for (let i = 0; i < n; i++) {
      const v = series[i];
      if (v === null) continue; // gap, not zero
      const x = padL + i * bw, bh = (v / ymax) * ih;
      ctx.fillStyle = i === st.hover ? '#fff' : color;
      ctx.globalAlpha = i === st.hover ? 1 : 0.8;
      ctx.fillRect(x + bw * 0.18, padT + ih - bh, Math.max(bw * 0.64, 1), bh);
    }
    ctx.globalAlpha = 1;
    /* moving average over non-null values */
    const win = Math.max(6, Math.round(n / 16));
    const ma: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - win + 1); j <= i; j++) {
        const v = series[j];
        if (v !== null) { s += v; c++; }
      }
      ma.push(c > 0 ? s / c : null);
    }
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = ma[i];
      if (v === null) { started = false; continue; }
      const x = padL + i * bw + bw / 2, y = Y(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.2; ctx.stroke();
    st.geom = { padL, iw, n, data: series };
  }, [code]);

  const dtLeave = useCallback(() => {
    S.current.hover = -1;
    if (tipRef.current) tipRef.current.style.display = 'none';
    drawBars();
  }, [drawBars]);

  const dtHover = useCallback((clientX: number) => {
    const cv = canvasRef.current, tip = tipRef.current, wrapEl = wrapRef.current;
    const g = S.current.geom;
    if (!cv || !tip || !wrapEl || !g) return;
    const rect = cv.getBoundingClientRect();
    const x = clientX - rect.left;
    const idx = Math.floor(((x - g.padL) / g.iw) * g.n);
    if (idx < 0 || idx > g.n - 1) { dtLeave(); return; }
    S.current.hover = idx;
    const st = S.current;
    const anchorTs = st.data?.anchorTs ?? Date.now();
    const bucketMs = st.data?.bucketMs ?? 1;
    const v = g.data[idx];
    tip.innerHTML =
      '<div class="tt">' + tipTime(bTime(anchorTs, bucketMs, g.n, idx)) + ' · ' + RANGES[st.range].blbl + ' bucket</div>' +
      '<div class="tr"><span class="ld" style="background:' + CHAINS[code].color + '"></span>' + code + '<b>' + (v === null ? '—' : fmtUsd(v)) + '</b></div>';
    tip.style.display = 'block';
    const wrap = wrapEl.getBoundingClientRect();
    let tx = clientX - wrap.left + 16;
    if (tx + tip.offsetWidth > wrap.width - 10) tx = clientX - wrap.left - tip.offsetWidth - 16;
    tip.style.left = tx + 'px'; tip.style.top = '16px';
    drawBars();
  }, [code, drawBars, dtLeave]);

  useEffect(() => { drawBars(); }, [data, range, drawBars]);
  useEffect(() => {
    const onResize = () => drawBars();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawBars]);

  return (
    <div className="chartwrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ height: 270 }}
        onMouseMove={(e) => dtHover(e.clientX)}
        onMouseLeave={dtLeave}
        onTouchMove={(e) => { if (e.touches[0]) dtHover(e.touches[0].clientX); }}
        onTouchEnd={dtLeave}
      />
      <div className="tip" ref={tipRef}></div>
    </div>
  );
}
