import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { StatsBar } from '@/components/StatsBar';
import { Footer } from '@/components/Footer';
import { DetailModal } from '@/components/DetailModal';
import { EditModal } from '@/components/EditModal';
import { ResidueBin } from '@/components/ResidueBin';
import { useWatchData } from '@/hooks/useWatchData';
import type { WatchRecord } from '@/types';
import { BrandBadge } from '@/components/ui/BrandBadge';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import { ConfidenceRing } from '@/components/ui/ConfidenceRing';
import { DialColorSwatch } from '@/components/ui/DialColorSwatch';
import { DemandBadge } from '@/components/ui/DemandBadge';
import { FilterChip } from '@/components/ui/FilterChip';
import {
  MessageSquare,
  Activity,
  FileSpreadsheet,
  Filter,
  Package,
  Paperclip,
  Star,
  Search,
} from 'lucide-react';

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0, 0, 0.2, 1] as [number, number, number, number] } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.05,
      duration: 0.4,
      ease: [0, 0, 0.2, 1] as [number, number, number, number],
    },
  }),
};

export default function Home() {
  const { records, loading, stats } = useWatchData();
  const [residueOpen, setResidueOpen] = useState(false);

  // Modal state
  const [selectedRecord, setSelectedRecord] = useState<WatchRecord | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<WatchRecord | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeConditions, setActiveConditions] = useState<string[]>([]);
  const [activeCurrencies, setActiveCurrencies] = useState<string[]>([]);

  // ---- Handlers ----

  const handleSelectRecord = useCallback((record: WatchRecord) => {
    setSelectedRecord(record);
    setDetailModalOpen(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleOpenEdit = useCallback((record: WatchRecord) => {
    setEditingRecord(record);
    setEditModalOpen(true);
    // If detail modal is open, close it
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleCloseEdit = useCallback(() => {
    setEditModalOpen(false);
    setEditingRecord(null);
  }, []);

  const handleApprove = useCallback((record: WatchRecord) => {
    // eslint-disable-next-line no-console
    console.log('Approve:', record.id);
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleDelete = useCallback((record: WatchRecord) => {
    // eslint-disable-next-line no-console
    console.log('Delete:', record.id);
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleFlag = useCallback((record: WatchRecord) => {
    // eslint-disable-next-line no-console
    console.log('Flag:', record.id);
    setDetailModalOpen(false);
    setSelectedRecord(null);
  }, []);

  const handleSaveEdit = useCallback((record: WatchRecord) => {
    // eslint-disable-next-line no-console
    console.log('Save & Re-run:', record.id);
    setEditModalOpen(false);
    setEditingRecord(null);
  }, []);

  // ---- Filtered inventory ----

  const normalizedRecords = useMemo(() => records.filter((r) => !r.isResidue), [records]);

  const filteredRecords = useMemo(() => {
    let result = normalizedRecords;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.reference?.toLowerCase().includes(q) ||
          r.brand?.toLowerCase().includes(q) ||
          r.family?.toLowerCase().includes(q)
      );
    }

    if (activeConditions.length > 0) {
      result = result.filter((r) => activeConditions.includes(r.condition));
    }

    if (activeCurrencies.length > 0) {
      result = result.filter((r) => activeCurrencies.includes(r.originalCurrency));
    }

    return result.slice(0, 200);
  }, [normalizedRecords, searchQuery, activeConditions, activeCurrencies]);

  const toggleCondition = useCallback((c: string) => {
    setActiveConditions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }, []);

  const toggleCurrency = useCallback((c: string) => {
    setActiveCurrencies((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setActiveConditions([]);
    setActiveCurrencies([]);
  }, []);

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

        {/* Filter Bar */}
        <div className="bg-bg-card border border-border-default rounded-md p-3 mb-3 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-grow max-w-[280px]">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search references, brands..."
              className="w-full h-8 pl-8 pr-2.5 bg-bg-input border border-border-default rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-gold-primary focus:ring-1 focus:ring-gold-primary/20 transition-colors"
            />
          </div>

          {/* Condition Chips */}
          <div className="flex items-center gap-1.5">
            {['New', 'Used', 'Like New', 'Naked'].map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={activeConditions.includes(c)}
                onClick={() => toggleCondition(c)}
              />
            ))}
          </div>

          {/* Currency Chips */}
          <div className="flex items-center gap-1.5">
            {['USD', 'HKD', 'EUR', 'GBP'].map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={activeCurrencies.includes(c)}
                onClick={() => toggleCurrency(c)}
              />
            ))}
          </div>

          {/* Clear All */}
          {(searchQuery || activeConditions.length > 0 || activeCurrencies.length > 0) && (
            <button
              onClick={clearFilters}
              className="ml-auto text-[10px] text-danger hover:underline cursor-pointer"
            >
              Clear All
            </button>
          )}

          {/* Filter Status */}
          <span className="text-[10px] text-text-muted ml-auto">
            Showing {filteredRecords.length.toLocaleString()} of {normalizedRecords.length.toLocaleString()}
          </span>
        </div>

        {/* Inventory Grid */}
        {loading ? (
          <div className="bg-bg-card border border-border-default rounded-md p-4" style={{ minHeight: 200 }}>
            <div className="flex items-center justify-center text-muted text-sm h-full py-20">
              <div className="flex items-center gap-2">
                <Filter size={16} />
                Loading inventory...
              </div>
            </div>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="bg-bg-card border border-border-default rounded-md p-4" style={{ minHeight: 200 }}>
            <div className="flex items-center justify-center text-muted text-sm h-full py-20">
              No records match your filters
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {filteredRecords.map((record, i) => (
              <motion.div
                key={record.id}
                custom={i}
                initial="hidden"
                animate="visible"
                variants={cardVariants}
                onClick={() => handleSelectRecord(record)}
                className="bg-bg-card border border-border-default rounded-md p-4 cursor-pointer hover:-translate-y-1 hover:shadow-gold hover:border-gold-muted transition-all duration-300"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <BrandBadge brand={record.brand} />
                  <ConfidenceRing percentage={record.confidence} size={32} />
                </div>

                {/* Reference */}
                <p className="font-mono text-[13px] font-semibold text-text-primary mb-1">
                  {record.reference}
                </p>

                {/* Family */}
                <p className="text-[10px] text-gold-muted font-semibold uppercase tracking-[0.04em] mb-2">
                  {record.family}
                </p>

                {/* Dial + Condition */}
                <div className="flex items-center gap-3 mb-2">
                  <DialColorSwatch color={record.dialColor} size={12} />
                  <ConditionBadge condition={record.condition} />
                </div>

                {/* Price */}
                <p className="text-base font-bold text-text-primary mb-2">
                  ${record.price.toLocaleString()}
                </p>

                {/* Metadata Row */}
                <div className="flex items-center gap-4 mb-2 flex-wrap">
                  <span className="flex items-center gap-1 text-[10px] text-text-secondary">
                    <Package size={12} className={record.hasBox ? 'text-success' : 'text-text-muted'} />
                    <Paperclip size={12} className={record.hasPapers ? 'text-success' : 'text-text-muted'} />
                  </span>
                  <span className="text-[10px] text-text-secondary">
                    {record.year ?? 'Unknown'}
                  </span>
                  <span className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, si) => (
                      <Star
                        key={si}
                        size={10}
                        className={si < record.sellerRating ? 'text-gold-primary fill-gold-primary' : 'text-bg-elevated'}
                      />
                    ))}
                  </span>
                </div>

                {/* ML Row */}
                <div className="flex items-center justify-between pt-2 border-t border-border-default">
                  <DemandBadge forecast={record.demandForecast} />
                  <span className="text-[10px] text-text-muted">{record.marketComparables} comps</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.section>

      {/* Residue Bin */}
      <ResidueBin
        records={records}
        expanded={residueOpen}
        onToggle={() => setResidueOpen(!residueOpen)}
        onApprove={handleApprove}
        onEdit={handleOpenEdit}
        onDelete={handleDelete}
      />

      {/* Detail Modal */}
      <DetailModal
        record={selectedRecord}
        open={detailModalOpen}
        onClose={handleCloseDetail}
        onApprove={handleApprove}
        onEdit={handleOpenEdit}
        onFlag={handleFlag}
        onDelete={handleDelete}
      />

      {/* Edit Modal */}
      <EditModal
        record={editingRecord}
        open={editModalOpen}
        onClose={handleCloseEdit}
        onSave={handleSaveEdit}
      />

      <Footer />
    </Layout>
  );
}
