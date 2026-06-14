import { Layout } from '@/components/Layout';
import { AnalyticsTab } from '@/sections/AnalyticsTab';
import { TabNav } from '@/components/TabNav';
import { useWatchData } from '@/hooks/useWatchData';
import { Footer } from '@/components/Footer';

export default function AnalyticsPage() {
  const { records, stats, loading } = useWatchData();

  return (
    <Layout
      totalProcessed={stats.totalProcessed}
      normalizedCount={stats.normalizedCount}
      residueCount={stats.residueCount}
      throughputRate={stats.throughputRate}
      avgLatency={stats.avgLatency}
    >
      <TabNav totalProcessed={stats.totalProcessed} />
      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-gold-primary/30 border-t-gold-primary animate-spin" />
          <p className="text-sm text-text-muted tracking-wide">Loading analytics…</p>
        </div>
      ) : (
        <AnalyticsTab records={records} />
      )}
      <Footer />
    </Layout>
  );
}
