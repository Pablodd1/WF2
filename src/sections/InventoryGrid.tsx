import type { WatchRecord } from '@/types';
import { useInventoryFilters } from '@/hooks/useInventoryFilters';
import { FilterBar } from './FilterBar';
import { WatchCard } from '@/components/WatchCard';
import { Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface InventoryGridProps {
  records: WatchRecord[];
  onSelectRecord: (record: WatchRecord) => void;
}

export function InventoryGrid({ records, onSelectRecord }: InventoryGridProps) {
  const filters = useInventoryFilters(records);

  return (
    <section>
      {/* Section title */}
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary">
          Inventory
        </h2>
        <span className="text-[10px] font-mono font-semibold text-text-muted bg-bg-card border border-border-default rounded-full px-2 py-0.5">
          {records.length.toLocaleString()}
        </span>
      </div>

      {/* Filter bar */}
      <div className="mb-4">
        <FilterBar filters={filters} resultCount={filters.filteredRecords.length} />
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 auto-rows-fr">
        <AnimatePresence mode="popLayout">
          {filters.filteredRecords.map((record, index) => (
            <WatchCard
              key={record.id}
              record={record}
              index={index}
              onSelect={onSelectRecord}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Empty state */}
      {filters.filteredRecords.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <Filter size={32} className="text-text-muted mb-3 opacity-50" />
          <p className="text-sm text-text-muted">
            No records match your filters
          </p>
          <button
            onClick={filters.clearFilters}
            className="mt-2 text-xs text-gold-primary hover:underline cursor-pointer"
          >
            Clear all filters
          </button>
        </motion.div>
      )}
    </section>
  );
}
