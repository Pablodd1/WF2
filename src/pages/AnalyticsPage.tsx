import { Layout } from '@/components/Layout';
import { AnalyticsTab } from '@/sections/AnalyticsTab';
import { TabNav } from '@/components/TabNav';
import { useWatchData } from '@/hooks/useWatchData';
import { Footer } from '@/components/Footer';

export default function AnalyticsPage() {
  const { records, stats } = useWatchData();

  return (
    <Layout
      totalProcessed={stats.totalProcessed}
      normalizedCount={stats.normalizedCount}
      residueCount={stats.residueCount}
      throughputRate={stats.throughputRate}
      avgLatency={stats.avgLatency}
    >
      <TabNav totalProcessed={stats.totalProcessed} />
      <AnalyticsTab records={records} />
      <Footer />
    </Layout>
  );
}
