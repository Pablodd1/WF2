import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Trash2, Edit3, ChevronDown, ChevronUp, Filter, Camera } from 'lucide-react';
import type { WatchRecord } from '@/types';

interface EnhancedResidueProps {
  records: WatchRecord[];
  onApprove: (record: WatchRecord) => void;
  onEdit: (record: WatchRecord) => void;
  onDelete: (record: WatchRecord) => void;
}

type SortKey = 'id' | 'reference' | 'price' | 'confidence' | 'severity';
type SortDir = 'asc' | 'desc';

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 3,
  WARNING: 2,
  INFO: 1,
};

const FLAG_COLORS: Record<string, string> = {
  PRICE_OUTLIER: '#EF4444',
  INCOMPLETE_REFERENCE: '#F59E0B',
  YEAR_MISSING: '#3B82F6',
  DIAL_UNKNOWN: '#8B5CF6',
  BOXPAPERS_UNKNOWN: '#6B7280',
  LOW_SELLER_RATING: '#EC4899',
  BRAND_UNCERTAIN: '#14B8A6',
  CURRENCY_MISMATCH: '#F97316',
};

export function EnhancedResidue({ records, onApprove, onEdit, onDelete }: EnhancedResidueProps) {
  const [sortKey, setSortKey] = useState<SortKey>('severity');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterFlag, setFilterFlag] = useState<string>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const residueRecords = useMemo(() => records.filter((r) => r.isResidue), [records]);
  
  // Auto-resolution stats
  const autoResolvedCount = useMemo(() => records.filter((r) => r.autoResolvedFlags && r.autoResolvedFlags.length > 0).length, [records]);
  const imageConfirmedCount = useMemo(() => records.filter((r) => r.imageConfirmed).length, [records]);

  // Get all unique flags
  const allFlags = useMemo(() => {
    const flags = new Set<string>();
    residueRecords.forEach((r) => r.failureFlags?.forEach((f) => flags.add(f)));
    return Array.from(flags);
  }, [residueRecords]);

  // Sort and filter
  const sorted = useMemo(() => {
    let filtered = filterFlag === 'all'
      ? residueRecords
      : residueRecords.filter((r) => r.failureFlags?.includes(filterFlag));

    filtered = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id':
          cmp = a.id.localeCompare(b.id);
          break;
        case 'reference':
          cmp = (a.reference || '').localeCompare(b.reference || '');
          break;
        case 'price':
          cmp = (a.price || 0) - (b.price || 0);
          break;
        case 'confidence':
          cmp = (a.confidence || 0) - (b.confidence || 0);
          break;
        case 'severity':
          cmp = (SEVERITY_ORDER[a.severity || 'INFO'] || 0) - (SEVERITY_ORDER[b.severity || 'INFO'] || 0);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [residueRecords, sortKey, sortDir, filterFlag]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-text-muted/30 ml-1">↕</span>;
    return sortDir === 'asc' ? <ChevronUp size={10} className="ml-1 text-gold-primary" /> : <ChevronDown size={10} className="ml-1 text-gold-primary" />;
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-5 mt-8 mb-8"
    >
      {/* Auto-resolution stats banner */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-bg-card border border-border-default rounded-md p-3 text-center">
          <div className="text-lg font-bold font-mono text-warning">{residueRecords.length}</div>
          <div className="text-[9px] text-text-muted uppercase">Needs Human Review</div>
        </div>
        <div className="bg-bg-card border border-border-default rounded-md p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <Camera size={14} className="text-success" />
            <span className="text-lg font-bold font-mono text-success">{imageConfirmedCount}</span>
          </div>
          <div className="text-[9px] text-text-muted uppercase">Image Confirmed</div>
        </div>
        <div className="bg-bg-card border border-border-default rounded-md p-3 text-center">
          <div className="text-lg font-bold font-mono text-info">{autoResolvedCount}</div>
          <div className="text-[9px] text-text-muted uppercase">Reviews Saved</div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <AlertTriangle size={16} className="text-warning" />
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-gold-primary">
            Residue Bin — Detailed Review
          </h2>
          <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded-full">
            {sorted.length} flagged
          </span>
          {autoResolvedCount > 0 && (
            <span className="text-[10px] bg-success/10 text-success px-2 py-0.5 rounded-full">
              {autoResolvedCount} auto-resolved by images
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter size={12} className="text-text-muted" />
          <select
            value={filterFlag}
            onChange={(e) => setFilterFlag(e.target.value)}
            className="bg-bg-elevated border border-border-default rounded px-2 py-1 text-[11px] text-text-primary"
          >
            <option value="all">All Flags</option>
            {allFlags.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-bg-card border border-border-default rounded-md overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[60px_120px_80px_100px_120px_80px_200px] gap-2 px-4 py-2 bg-bg-elevated border-b border-border-default text-[10px] font-bold uppercase tracking-wider text-text-muted">
          <button onClick={() => handleSort('id')} className="text-left flex items-center">ID <SortIcon col="id" /></button>
          <button onClick={() => handleSort('reference')} className="text-left flex items-center">Reference <SortIcon col="reference" /></button>
          <button onClick={() => handleSort('price')} className="text-right flex items-center justify-end">Price <SortIcon col="price" /></button>
          <span className="text-left">Flags</span>
          <button onClick={() => handleSort('severity')} className="text-left flex items-center">Severity <SortIcon col="severity" /></button>
          <button onClick={() => handleSort('confidence')} className="text-right flex items-center justify-end">Conf <SortIcon col="confidence" /></button>
          <span className="text-right">Actions</span>
        </div>

        {/* Table Rows */}
        <div className="max-h-[600px] overflow-y-auto">
          {sorted.map((record) => (
            <div key={record.id}>
              <div
                className="grid grid-cols-[60px_120px_80px_100px_120px_80px_200px] gap-2 px-4 py-2 border-b border-border-default/50 hover:bg-bg-elevated transition-colors items-center"
                onClick={() => toggleRow(record.id)}
                style={{ cursor: 'pointer' }}
              >
                <span className="font-mono text-[11px] text-text-primary flex items-center gap-1">
                  {record.id}
                  {record.imageConfirmed && (
                    <span title="Image confirmed"><Camera size={10} className="text-success" /></span>
                  )}
                </span>
                <span className="font-mono text-[11px] text-gold-primary truncate">{record.reference || 'N/A'}</span>
                <span className="text-right font-mono text-[11px] text-text-primary">
                  ${(record.price || 0).toLocaleString()}
                </span>
                <div className="flex flex-wrap gap-1">
                  {record.failureFlags?.slice(0, 2).map((flag) => (
                    <span
                      key={flag}
                      className="text-[8px] px-1 py-0.5 rounded"
                      style={{ background: `${FLAG_COLORS[flag] || '#6B7280'}20`, color: FLAG_COLORS[flag] || '#6B7280' }}
                    >
                      {flag}
                    </span>
                  ))}
                  {(record.failureFlags?.length || 0) > 2 && (
                    <span className="text-[8px] text-text-muted">+{(record.failureFlags?.length || 0) - 2}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{
                      background:
                        record.severity === 'CRITICAL' ? '#EF4444' :
                        record.severity === 'WARNING' ? '#F59E0B' : '#3B82F6',
                    }}
                  />
                  <span className="text-[10px] text-text-secondary">{record.severity}</span>
                </div>
                <div className="text-right">
                  <span
                    className="text-[11px] font-mono font-bold"
                    style={{ color: (record.confidence || 0) >= 70 ? '#22C55E' : '#F59E0B' }}
                  >
                    {record.confidence || 0}%
                  </span>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); onApprove(record); }}
                    className="p-1 rounded hover:bg-success/20 text-success transition-colors"
                    title="Approve"
                  >
                    <CheckCircle size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(record); }}
                    className="p-1 rounded hover:bg-info/20 text-info transition-colors"
                    title="Edit"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(record); }}
                    className="p-1 rounded hover:bg-danger/20 text-danger transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {expandedRows.has(record.id) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-bg-elevated/50 border-b border-border-default px-4 py-3"
                >
                  <div className="text-[10px] text-text-muted font-mono break-all mb-2">
                    SOURCE: {record.rawMessage}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div><span className="text-text-muted">Brand:</span> <span className="text-text-primary">{record.brand}</span></div>
                    <div><span className="text-text-muted">Family:</span> <span className="text-text-primary">{record.family}</span></div>
                    <div><span className="text-text-muted">Dial:</span> <span className="text-text-primary">{record.dialColor}</span></div>
                    <div><span className="text-text-muted">Condition:</span> <span className="text-text-primary">{record.condition}</span></div>
                    <div><span className="text-text-muted">Year:</span> <span className="text-text-primary">{record.year || 'N/A'}</span></div>
                    <div><span className="text-text-muted">Box/Papers:</span> <span className="text-text-primary">{record.hasBox ? 'Box' : ''} {record.hasPapers ? 'Papers' : ''}</span></div>
                  </div>
                  {/* Auto-resolved flags */}
                  {record.autoResolvedFlags && record.autoResolvedFlags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 items-center">
                      <span className="text-[9px] text-success mr-1 flex items-center gap-1">
                        <Camera size={10} /> IMG RESOLVED:
                      </span>
                      {record.autoResolvedFlags.map((flag) => (
                        <span key={flag} className="text-[9px] bg-success/10 text-success px-1.5 py-0.5 rounded line-through opacity-70">
                          {flag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[9px] text-text-muted mr-1">REMAINING FLAGS:</span>
                    {record.failureFlags?.map((flag) => (
                      <span
                        key={flag}
                        className="text-[9px] px-1.5 py-0.5 rounded border"
                        style={{
                          borderColor: FLAG_COLORS[flag] || '#6B7280',
                          color: FLAG_COLORS[flag] || '#6B7280',
                          background: `${FLAG_COLORS[flag] || '#6B7280'}10`,
                        }}
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
