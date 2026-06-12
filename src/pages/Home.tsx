import { useState, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { StatsBar } from '@/components/StatsBar';
import { Footer } from '@/components/Footer';
import { ProcessingTheater } from '@/sections/ProcessingTheater';
import { InventoryGrid } from '@/sections/InventoryGrid';
import { LiquidityTaxonomy } from '@/sections/LiquidityTaxonomy';
import { EnhancedResidue } from '@/sections/EnhancedResidue';
import { WorkflowSidebar } from '@/components/WorkflowSidebar';
import { DetailModal } from '@/components/DetailModal';
import { EditModal } from '@/components/EditModal';
import { AIInsights } from '@/sections/AIInsights';
import { useWatchData } from '@/hooks/useWatchData';
import type { WatchRecord } from '@/types';

export default function Home() {
  const { records, stats } = useWatchData();

  // Modal state
  const [selectedRecord, setSelectedRecord] = useState<WatchRecord | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<WatchRecord | null>(null);

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

  const handleExportExcel = useCallback(() => {
    const link = document.createElement('a');
    link.href = '/Patek_Philippe_Analytics.xlsx';
    link.download = 'Patek_Philippe_Analytics.xlsx';
    link.click();
  }, []);

  return (
    <Layout
      totalProcessed={stats.totalProcessed}
      normalizedCount={stats.normalizedCount}
      residueCount={stats.residueCount}
      throughputRate={stats.throughputRate}
      avgLatency={stats.avgLatency}
    >
      {/* Workflow Sidebar */}
      <WorkflowSidebar
        totalRecords={stats.totalProcessed}
        normalizedCount={stats.normalizedCount}
        residueCount={stats.residueCount}
        onExportExcel={handleExportExcel}
      />

      <div className="ml-0">
        {/* Stats Bar */}
        <StatsBar
        totalProcessed={stats.totalProcessed}
        accuracyRate={stats.accuracyRate}
        mlAvgTime={stats.mlAvgTime}
        residueRate={stats.residueRate}
      />

      {/* Processing Theater Section */}
      <ProcessingTheater
        records={records}
        normalizedCount={stats.normalizedCount}
        residueCount={stats.residueCount}
      />

      {/* Inventory Section */}
      <InventoryGrid
        records={records}
        onSelectRecord={handleSelectRecord}
      />

      {/* Liquidity & Taxonomy — NEW */}
      <LiquidityTaxonomy />

      {/* AI Intelligence Center */}
      <AIInsights
        records={records}
        onSelectRecord={handleSelectRecord}
      />

      {/* Enhanced Residue Bin — NEW */}
      <EnhancedResidue
        records={records}
        onApprove={handleApprove}
        onEdit={handleOpenEdit}
        onDelete={handleDelete}
      />

      </div>

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
