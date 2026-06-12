import { useState, useEffect } from 'react';
import type { WatchRecord } from '@/types';

interface WatchDataResult {
  records: WatchRecord[];
  loading: boolean;
  error: string | null;
  stats: {
    totalProcessed: number;
    normalizedCount: number;
    residueCount: number;
    throughputRate: number;
    avgLatency: number;
    accuracyRate: number;
    mlAvgTime: number;
    residueRate: number;
  };
}

export function useWatchData(): WatchDataResult {
  const [records, setRecords] = useState<WatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/parsedWatches.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const arr = Array.isArray(data) ? data : data.records ?? [];
        const typed: WatchRecord[] = arr.map((r: Record<string, unknown>) => ({
          ...r,
          source: (r.source as string)?.toLowerCase() as WatchRecord['source'] ?? 'whatsapp',
        }));
        setRecords(typed);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const normalizedRecords = records.filter((r) => !r.isResidue);
  const residueRecords = records.filter((r) => r.isResidue);
  const totalProcessed = records.length;
  const normalizedCount = normalizedRecords.length;
  const residueCount = residueRecords.length;

  const accuracyRate = totalProcessed > 0
    ? Math.round((normalizedCount / totalProcessed) * 1000) / 10
    : 0;

  const avgLatency = totalProcessed > 0
    ? Math.round(records.reduce((sum, r) => sum + (r.processingTime ?? 0), 0) / totalProcessed)
    : 0;

  const mlAvgTime = normalizedCount > 0
    ? Math.round(normalizedRecords.reduce((sum, r) => sum + (r.processingTime ?? 0), 0) / normalizedCount)
    : 0;

  const residueRate = totalProcessed > 0
    ? Math.round((residueCount / totalProcessed) * 1000) / 10
    : 0;

  const throughputRate = avgLatency > 0
    ? Math.round((60000 / avgLatency) * 10) / 10
    : 0;

  return {
    records,
    loading,
    error,
    stats: {
      totalProcessed,
      normalizedCount,
      residueCount,
      throughputRate,
      avgLatency,
      accuracyRate,
      mlAvgTime,
      residueRate,
    },
  };
}
