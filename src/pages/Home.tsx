import { useState } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { StatsBar } from '@/components/StatsBar';
import { Footer } from '@/components/Footer';
import { useWatchData } from '@/hooks/useWatchData';
import { MessageSquare, Activity, FileSpreadsheet, Filter } from 'lucide-react';

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0, 0, 0.2, 1] as [number, number, number, number] } },
};

export default function Home() {
  const { records, loading, stats } = useWatchData();
  const [residueOpen, setResidueOpen] = useState(false);

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
      <motion.section
        initial="hidden"
        animate="visible"
        variants={sectionVariants}
        className="px-5 mt-4"
      >
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary mb-3">
          LIVE PROCESSING THEATER
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr_1fr] gap-3" style={{ minHeight: 400 }}>
          {/* Column 1: RAW STREAM */}
          <div className="bg-bg-card border border-border-default rounded-md p-3 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-border-default">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary">
                  RAW STREAM
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  <span className="text-[10px] text-success font-semibold">LIVE</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1"><MessageSquare size={10} className="text-success" /><span className="text-[9px] text-muted">WA</span></span>
                <span className="flex items-center gap-1"><Activity size={10} className="text-purple" /><span className="text-[9px] text-muted">WS</span></span>
                <span className="flex items-center gap-1"><FileSpreadsheet size={10} className="text-info" /><span className="text-[9px] text-muted">CSV</span></span>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center text-muted text-sm">
              {loading ? 'Loading data...' : 'Waiting for stream data...'}
            </div>
          </div>

          {/* Column 2: ANALYSIS ENGINE */}
          <div className="bg-bg-card border border-border-default rounded-md p-3 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-border-default">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary">
                ANALYSIS ENGINE
              </span>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple animate-pulse" />
                <span className="text-[10px] text-purple font-semibold">READY</span>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center text-muted text-sm">
              {loading ? 'Loading pipeline...' : 'Pipeline ready...'}
            </div>
          </div>

          {/* Column 3: RESULTS OUTPUT */}
          <div className="bg-bg-card border border-border-default rounded-md p-3 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-border-default">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary">
                RESULTS OUTPUT
              </span>
              <span className="text-[10px] text-muted">
                {stats.normalizedCount.toLocaleString()} norm / {stats.residueCount.toLocaleString()} res
              </span>
            </div>
            <div className="flex-1 flex items-center justify-center text-muted text-sm">
              {loading ? 'Loading results...' : 'Waiting for pipeline output...'}
            </div>
          </div>
        </div>
      </motion.section>

      {/* Inventory Section */}
      <motion.section
        initial="hidden"
        animate="visible"
        variants={{ ...sectionVariants, visible: { ...sectionVariants.visible, transition: { ...sectionVariants.visible.transition, delay: 0.15 } } }}
        className="px-5 mt-8"
      >
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary mb-3">
          INVENTORY
        </h2>
        <div className="bg-bg-card border border-border-default rounded-md p-4" style={{ minHeight: 200 }}>
          <div className="flex items-center justify-center text-muted text-sm h-full py-20">
            <div className="flex items-center gap-2">
              <Filter size={16} />
              {loading ? 'Loading inventory...' : `${records.length.toLocaleString()} records loaded — inventory grid will appear here`}
            </div>
          </div>
        </div>
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="text-sm font-bold uppercase text-warning">RESIDUE BIN</span>
            <span className="text-[10px] font-semibold text-warning bg-warning-dim rounded-full px-2 py-0.5">
              {stats.residueCount} items
            </span>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-muted transition-transform duration-300 ${residueOpen ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
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
