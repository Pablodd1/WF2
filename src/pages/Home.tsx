import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { StatsBar } from '@/components/StatsBar';
import { Footer } from '@/components/Footer';
import { ProcessingTheater } from '@/sections/ProcessingTheater';
import { InventoryGrid } from '@/sections/InventoryGrid';
import { useWatchData } from '@/hooks/useWatchData';
import type { WatchRecord } from '@/types';
import { AlertTriangle, ChevronDown } from 'lucide-react';

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0, 0, 0.2, 1] as [number, number, number, number] } },
};

export default function Home() {
  const { records, loading, stats } = useWatchData();
  const [selectedRecord, setSelectedRecord] = useState<WatchRecord | null>(null);
  const [residueOpen, setResidueOpen] = useState(false);

  const handleSelectRecord = (record: WatchRecord) => {
    setSelectedRecord(record);
    // Detail modal will be implemented by another agent
    // For now, just log the selection
    // eslint-disable-next-line no-console
    console.log('Selected record:', record.id);
  };

  return (
    <Layout
      totalProcessed={stats.totalProcessed}
      normalizedCount={stats.normalizedCount}
      residueCount={stats.residueCount}
      throughputRate={stats.throughputRate}
      avgLatency={stats.avgLatency}
    >
      {/* Stats Bar */}
      <StatsBar
        totalProcessed={stats.totalProcessed}
        accuracyRate={stats.accuracyRate}
        mlAvgTime={stats.mlAvgTime}
        residueRate={stats.residueRate}
      />

      {/* Processing Theater Section */}
      {loading ? (
        <motion.section
          initial="hidden"
          animate="visible"
          variants={sectionVariants}
          className="px-5 mt-4"
        >
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary mb-3">
            LIVE PROCESSING THEATER
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr_1fr] gap-3" style={{ minHeight: 520 }}>
            <div className="bg-bg-card border border-border-default rounded-md p-3 flex items-center justify-center text-muted text-sm">
              Loading stream data...
            </div>
            <div className="bg-bg-card border border-border-default rounded-md p-3 flex items-center justify-center text-muted text-sm">
              Loading pipeline...
            </div>
            <div className="bg-bg-card border border-border-default rounded-md p-3 flex items-center justify-center text-muted text-sm">
              Loading results...
            </div>
          </div>
        </motion.section>
      ) : (
        <ProcessingTheater
          records={records}
          normalizedCount={stats.normalizedCount}
          residueCount={stats.residueCount}
        />
      )}

      {/* Inventory Section */}
      <motion.section
        initial="hidden"
        animate="visible"
        variants={{ ...sectionVariants, visible: { ...sectionVariants.visible, transition: { ...sectionVariants.visible.transition, delay: 0.15 } } }}
        className="px-5 mt-8"
      >
        <InventoryGrid records={records} onSelectRecord={handleSelectRecord} />
      </motion.section>

      {/* Residue Bin Section */}
      <motion.section
        initial="hidden"
        animate="visible"
        variants={{ ...sectionVariants, visible: { ...sectionVariants.visible, transition: { ...sectionVariants.visible.transition, delay: 0.3 } } }}
        className="px-5 mt-8 mb-8"
      >
        <button
          onClick={() => setResidueOpen(!residueOpen)}
          className="w-full h-11 bg-bg-card border border-border-default rounded-md px-4 flex items-center justify-between hover:border-border-hover transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning" />
            <span className="text-sm font-bold uppercase text-warning">RESIDUE BIN</span>
            <span className="text-[10px] font-semibold text-warning bg-warning-dim rounded-full px-2 py-0.5">
              {stats.residueCount} items
            </span>
          </div>
          <ChevronDown
            size={16}
            className={`text-muted transition-transform duration-300 ${residueOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {residueOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-bg-card border border-t-0 border-border-default rounded-b-md p-4"
          >
            <p className="text-sm text-muted text-center py-8">
              Residue bin content will be implemented here
            </p>
          </motion.div>
        )}
      </motion.section>

      <Footer />
    </Layout>
  );
}
