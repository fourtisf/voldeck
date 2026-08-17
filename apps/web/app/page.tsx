import VolumeChart from '@/components/VolumeChart';
import ChainsTable from '@/components/ChainsTable';
import OverviewHeat from '@/components/OverviewHeat';

export default function OverviewPage() {
  return (
    <>
      <VolumeChart />
      <ChainsTable />
      <OverviewHeat />
    </>
  );
}
