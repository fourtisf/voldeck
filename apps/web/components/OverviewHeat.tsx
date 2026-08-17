'use client';

import { ORDER } from '@voldeck/shared';
import { useOverview } from '@/lib/hooks';
import Heat, { hourlyAgg } from './Heat';

export default function OverviewHeat() {
  const { data } = useOverview();
  return (
    <div className="panel">
      <div className="phead"><span className="ttl">Hourly volume heat</span><span className="subt">last 24h · UTC</span></div>
      {data ? (
        <Heat
          rows={ORDER.map((ch) => {
            const row = data.chains.find((c) => c.chain === ch);
            return { ch, cells: hourlyAgg(row?.spark ?? []) };
          })}
          anchorTs={data.anchorTs - 95 * data.bucketMs}
          showLabels
        />
      ) : (
        <div className="heatbody"><span className="subt">Loading…</span></div>
      )}
    </div>
  );
}
