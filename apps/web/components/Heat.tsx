'use client';

import { CHAINS, tint, clamp, fmtUsd, type ChainCode } from '@voldeck/shared';

const p2 = (n: number) => String(n).padStart(2, '0');

export interface HeatRowData {
  ch: ChainCode;
  /** 24 hourly sums, oldest first */
  cells: number[];
}

/**
 * Hourly heat grid — heatHTML ported from the prototype. `anchorTs` is the
 * start ts of the first (oldest) hour cell; each cell advances one hour.
 */
export default function Heat({
  rows, anchorTs, showLabels,
}: {
  rows: HeatRowData[];
  anchorTs: number;
  showLabels: boolean;
}) {
  const hourOf = (i: number) => new Date(anchorTs + i * 3600_000).getUTCHours();
  return (
    <div className="heatbody">
      {rows.map((row) => {
        const mx = Math.max(...row.cells, 0) || 1;
        return (
          <div className="hrow" key={row.ch}>
            <span className="hl">{showLabels ? row.ch : ''}</span>
            <div className="hcells">
              {row.cells.map((v, i) => (
                <div
                  key={i}
                  className="hc"
                  title={row.ch + ' · ' + p2(hourOf(i)) + ':00 UTC · ' + fmtUsd(v)}
                  style={{ background: tint(CHAINS[row.ch].color, clamp(v / mx, 0.08, 1)) }}
                ></div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="haxis">
        <span></span>
        <div className="hcells">
          {Array.from({ length: 24 }, (_, i) =>
            i % 4 !== 0
              ? <span className="hx" key={i}></span>
              : <span className="hx" key={i}>{p2(hourOf(i))}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Aggregate a 96×15m spark array into 24 hourly cells (prototype hourlyAgg). */
export function hourlyAgg(spark: (number | null)[]): number[] {
  const cells: number[] = [];
  for (let i = 0; i < 24; i++) {
    cells.push((spark[i * 4] ?? 0) + (spark[i * 4 + 1] ?? 0) + (spark[i * 4 + 2] ?? 0) + (spark[i * 4 + 3] ?? 0));
  }
  return cells;
}
