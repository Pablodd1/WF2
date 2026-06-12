import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ScatterChart, Scatter
} from 'recharts';
import { BarChart3, TrendingUp, AlertTriangle, CheckCircle, DollarSign, Package, Users, Activity } from 'lucide-react';
import type { WatchRecord } from '@/types';

interface AnalyticsTabProps {
  records: WatchRecord[];
}

const COLORS = ['#C9A96E', '#22C55E', '#3B82F6', '#8B5CF6', '#EF4444', '#F59E0B', '#14B8A6', '#EC4899', '#6B7280', '#F97316'];

export function AnalyticsTab({ records }: AnalyticsTabProps) {
  // Brand distribution
  const brandData = useMemo(() => {
    const counts: Record<string, number> = {};
    records.forEach((r) => {
      counts[r.brand] = (counts[r.brand] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [records]);

  // Condition breakdown
  const conditionData = useMemo(() => {
    const counts: Record<string, number> = {};
    records.forEach((r) => {
      counts[r.condition] = (counts[r.condition] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [records]);

  // Demand forecast
  const demandData = useMemo(() => {
    const counts: Record<string, number> = {};
    records.forEach((r) => {
      counts[r.demandForecast] = (counts[r.demandForecast] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({
      name, value, color: name === 'HIGH' ? '#22C55E' : name === 'RISING' ? '#3B82F6' : name === 'STABLE' ? '#F59E0B' : '#6B7280'
    }));
  }, [records]);

  // Price distribution buckets
  const priceDistData = useMemo(() => {
    const buckets = [
      { range: '<$50K', min: 0, max: 50000, count: 0 },
      { range: '$50-100K', min: 50000, max: 100000, count: 0 },
      { range: '$100-200K', min: 100000, max: 200000, count: 0 },
      { range: '$200-500K', min: 200000, max: 500000, count: 0 },
      { range: '$500K-1M', min: 500000, max: 1000000, count: 0 },
      { range: '$1M+', min: 1000000, max: Infinity, count: 0 },
    ];
    records.forEach((r) => {
      const p = r.price || 0;
      const bucket = buckets.find((b) => p >= b.min && p < b.max);
      if (bucket) bucket.count++;
    });
    return buckets;
  }, [records]);

  // Price vs Confidence scatter
  const scatterData = useMemo(() => {
    return records
      .filter((r) => r.price > 0)
      .map((r) => ({
        x: r.price,
        y: r.confidence || 0,
        brand: r.brand,
        reference: r.reference,
        dial: r.dialColor,
      }));
  }, [records]);

  // Top 10 most expensive
  const topExpensive = useMemo(() => {
    return [...records]
      .filter((r) => r.price > 0)
      .sort((a, b) => b.price - a.price)
      .slice(0, 10)
      .map((r) => ({
        name: `${r.reference}`,
        price: r.price,
        brand: r.brand,
      }));
  }, [records]);

  // Residue breakdown
  const residueData = useMemo(() => {
    const flagCounts: Record<string, number> = {};
    records.forEach((r) => {
      if (r.failureFlags) {
        r.failureFlags.forEach((f) => {
          flagCounts[f] = (flagCounts[f] || 0) + 1;
        });
      }
    });
    return Object.entries(flagCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [records]);

  // Summary stats
  const stats = useMemo(() => {
    const normal = records.filter((r) => !r.isResidue);
    return {
      total: records.length,
      normalized: normal.length,
      residue: records.filter((r) => r.isResidue).length,
      avgPrice: normal.length > 0 ? Math.round(normal.reduce((s, r) => s + r.price, 0) / normal.length) : 0,
      avgConfidence: normal.length > 0 ? Math.round(normal.reduce((s, r) => s + r.confidence, 0) / normal.length) : 0,
      totalValue: normal.reduce((s, r) => s + r.price, 0),
      brands: new Set(records.map((r) => r.brand)).size,
      withImages: records.filter((r) => r.imageUrl).length,
      imageResolved: records.filter((r) => r.imageConfirmed).length,
    };
  }, [records]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="px-5 py-6"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 size={20} className="text-gold-primary" />
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-gold-primary">
          Comprehensive Analytics Summary
        </h2>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        {[
          { label: 'Total Records', value: stats.total, icon: Package, color: 'text-text-primary' },
          { label: 'Normalized', value: stats.normalized, icon: CheckCircle, color: 'text-success' },
          { label: 'Residue', value: stats.residue, icon: AlertTriangle, color: 'text-warning' },
          { label: 'Avg Price', value: `$${(stats.avgPrice / 1000).toFixed(0)}K`, icon: DollarSign, color: 'text-gold-primary' },
          { label: 'Avg Confidence', value: `${stats.avgConfidence}%`, icon: TrendingUp, color: 'text-info' },
          { label: 'Total Value', value: `$${(stats.totalValue / 1000000).toFixed(1)}M`, icon: DollarSign, color: 'text-success' },
          { label: 'Brands', value: stats.brands, icon: Users, color: 'text-purple' },
          { label: 'With Images', value: stats.withImages, icon: Activity, color: 'text-text-primary' },
        ].map((s) => (
          <div key={s.label} className="bg-bg-card border border-border-default rounded-md p-3 text-center">
            <s.icon size={14} className={`mx-auto mb-1 ${s.color}`} />
            <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
            <div className="text-[8px] uppercase tracking-wider text-text-muted mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Brand Distribution */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Brand Distribution</h4>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={brandData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {brandData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Price Distribution */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Price Distribution</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={priceDistData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
              <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} />
              <Bar dataKey="count" fill="#C9A96E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Demand Forecast */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Demand Forecast</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={demandData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
              <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {demandData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Condition Breakdown */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Condition Breakdown</h4>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={conditionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {conditionData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Price vs Confidence */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Price vs Confidence</h4>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" />
              <XAxis type="number" dataKey="x" name="Price" domain={[0, 'auto']} tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="number" dataKey="y" name="Confidence" domain={[0, 100]} tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} formatter={(value: number, name: string) => [`${name === 'x' ? '$' : ''}${value.toLocaleString()}${name === 'y' ? '%' : ''}`, name === 'x' ? 'Price' : 'Confidence']} />
              <Scatter data={scatterData} fill="#8B5CF6" fillOpacity={0.6} r={4} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Top 10 Most Expensive */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Top 10 Most Expensive</h4>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topExpensive} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#9CA3AF' }} stroke="#1E1E2E" width={70} />
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} formatter={(value: number) => [`$${value.toLocaleString()}`, 'Price']} />
              <Bar dataKey="price" fill="#C9A96E" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Residue Breakdown */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Residue Breakdown by Flag</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={residueData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2E" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} stroke="#1E1E2E" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#9CA3AF' }} stroke="#1E1E2E" width={100} />
              <Tooltip contentStyle={{ background: '#1A1A24', border: '1px solid #2A2A3E', borderRadius: 6, fontSize: 11 }} />
              <Bar dataKey="value" fill="#EF4444" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Image Resolution Impact */}
        <div className="bg-bg-card border border-border-default rounded-md p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-secondary mb-3">Image Auto-Resolution Impact</h4>
          <div className="flex flex-col items-center justify-center h-[220px]">
            <div className="relative w-32 h-32">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#1E1E2E" strokeWidth="8" />
                <circle
                  cx="50" cy="50" r="40"
                  fill="none"
                  stroke="#22C55E"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 40}
                  strokeDashoffset={2 * Math.PI * 40 * (1 - stats.imageResolved / Math.max(stats.residue + stats.imageResolved, 1))}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold font-mono text-success">{stats.imageResolved}</span>
                <span className="text-[8px] text-text-muted uppercase">Resolved</span>
              </div>
            </div>
            <div className="mt-3 text-center">
              <div className="text-sm text-text-primary">{stats.residue} still need review</div>
              <div className="text-[10px] text-success">
                {stats.residue + stats.imageResolved > 0
                  ? `${Math.round((stats.imageResolved / (stats.residue + stats.imageResolved)) * 100)}% auto-resolved`
                  : '0% auto-resolved'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
