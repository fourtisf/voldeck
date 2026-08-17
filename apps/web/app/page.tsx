import VolumeChart from '@/components/VolumeChart';
import ChainsTable from '@/components/ChainsTable';
import Launchpads from '@/components/Launchpads';
import LaunchpadWars from '@/components/LaunchpadWars';
import DominanceChart from '@/components/DominanceChart';
import OverviewHeat from '@/components/OverviewHeat';

export default function OverviewPage() {
  return (
    <>
      <VolumeChart />
      <ChainsTable />
      <Launchpads />
      <LaunchpadWars />
      <DominanceChart />
      <OverviewHeat />
    </>
  );
}
