import { useState, useEffect, useCallback } from 'react';
import type { WatchRecord, PipelineStage } from '@/types';

interface RawStageLog {
  stage: string;
  time: string;
  message: string;
}

interface RawRecord {
  id: string;
  hash: string;
  sourceType: string;
  sourceLine: string;
  brand: string;
  reference: string;
  family: string;
  dial: string;
  condition: string;
  boxPapers: string;
  price: number;
  currency: string;
  priceUSD: number;
  year: number | null;
  seller: string;
  location: string;
  confidence: number;
  status: string;
  flags: string[];
  timestamp: string;
  mlPredictedPrice: number;
  mlPriceConfidence: number;
  mlDemandForecast: string;
  mlOutcomeClass: string;
  mlOutcomeConfidence: number;
  marketComparables: number;
  sellerRating: number;
  daysOnMarket: number;
  stageLogs: RawStageLog[];
}

function transformRecord(raw: RawRecord): WatchRecord {
  // Map boxPapers string to booleans
  const bp = (raw.boxPapers || '').toLowerCase();
  const hasBox = bp.includes('full set') || bp.includes('box') || bp.includes('card');
  const hasPapers = bp.includes('full set') || bp.includes('papers') || bp.includes('card');

  // Map source type
  const sourceMap: Record<string, 'whatsapp' | 'websocket' | 'csv'> = {
    'WhatsApp': 'whatsapp',
    'WebSocket': 'websocket',
    'CSV': 'csv',
  };

  // Transform stage logs to pipeline stages
  const pipelineLog: PipelineStage[] = (raw.stageLogs || []).map((log, i) => {
    const status = log.stage === 'FAIL' ? 'failed' : 
                   i === raw.stageLogs.length - 1 ? 'completed' : 'completed';
    return {
      name: (log.stage === 'FAIL' ? 'VALIDATE' : log.stage) as PipelineStage['name'],
      status: status as PipelineStage['status'],
      message: log.message,
      timestamp: i,
    };
  });

  // Calculate severity
  let severity: 'CRITICAL' | 'WARNING' | 'INFO' = 'INFO';
  if (raw.flags?.some((f: string) => f === 'PRICE_OUTLIER')) {
    severity = 'CRITICAL';
  } else if (raw.flags?.some((f: string) => f === 'INCOMPLETE_REFERENCE' || f === 'YEAR_MISSING')) {
    severity = 'WARNING';
  }

  // Calculate price variance
  const priceVariance = raw.priceUSD > 0 
    ? ((raw.mlPredictedPrice - raw.priceUSD) / raw.priceUSD) * 100 
    : 0;

  return {
    id: raw.id,
    source: sourceMap[raw.sourceType] || 'whatsapp',
    rawMessage: raw.sourceLine || '',
    timestamp: raw.timestamp || '',
    brand: raw.brand || 'Unknown',
    reference: raw.reference || 'Unknown',
    family: raw.family || 'Other',
    price: raw.priceUSD || 0,
    originalPrice: raw.price || 0,
    originalCurrency: raw.currency || 'USD',
    dialColor: raw.dial || 'UNKNOWN',
    condition: raw.condition || 'Unknown',
    hasBox,
    hasPapers,
    year: raw.year,
    sellerRating: raw.sellerRating || 0,
    daysOnMarket: raw.daysOnMarket || 0,
    confidence: raw.confidence || 0,
    mlPredictedPrice: raw.mlPredictedPrice || 0,
    priceVariance: Math.round(priceVariance * 100) / 100,
    demandForecast: raw.mlDemandForecast || 'STABLE',
    outcomeClassification: raw.mlOutcomeClass || 'HOLD',
    marketComparables: raw.marketComparables || 0,
    processingTime: raw.stageLogs ? raw.stageLogs.length * 300 : 1500,
    pipelineLog,
    isResidue: raw.status === 'RESIDUE',
    failureFlags: raw.flags || [],
    severity,
  };
}

export function useWatchData() {
  const [records, setRecords] = useState<WatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/parsedWatches.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((rawData: RawRecord[]) => {
        const transformed = rawData.map(transformRecord);
        setRecords(transformed);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load watch data:', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const stats = {
    totalProcessed: records.length,
    normalizedCount: records.filter((r) => !r.isResidue).length,
    residueCount: records.filter((r) => r.isResidue).length,
    throughputRate: Math.round(records.length / 2.4), // ~ records per simulated minute
    avgLatency: 45,
    accuracyRate: records.length > 0
      ? Math.round((records.filter((r) => !r.isResidue).length / records.length) * 100)
      : 0,
    mlAvgTime: 45,
    residueRate: records.length > 0
      ? Math.round((records.filter((r) => r.isResidue).length / records.length) * 100)
      : 0,
  };

  return { records, loading, error, stats };
}
