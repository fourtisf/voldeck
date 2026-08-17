'use client';

import { useEffect, useRef } from 'react';

/** Inline table sparkline — drawSpark ported from the prototype. */
export default function Spark({ data, color }: { data: (number | null)[]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || cv.offsetParent === null) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const w = 96, h = 28, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; ctx.scale(dpr, dpr);
    const vals = data.filter((v): v is number => v !== null);
    if (vals.length < 2) return;
    const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
    const X = (i: number) => (i / (data.length - 1)) * w;
    const Y = (v: number) => h - 2 - ((v - mn) / rg) * (h - 5);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v === null) { started = false; continue; }
      if (!started) { ctx.moveTo(X(i), Y(v)); started = true; }
      else ctx.lineTo(X(i), Y(v));
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.stroke();
  }, [data, color]);

  return <canvas ref={ref} />;
}
