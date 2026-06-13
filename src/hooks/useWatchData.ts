import { useState, useEffect } from 'react';
import type { WatchRecord, PipelineStage } from '@/types';
import { detectCurrency } from '@/lib/currency';
import { normalizeDialColor, normalizeReference } from '@/lib/catalog';

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
  dial?: string;
  dialColor?: string;
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
  imageUrl?: string | null;
  imageCount?: number;
  imageConfirmed?: boolean;
  autoResolvedFlags?: string[];
  buyerCount?: number;
  sellerCount?: number;
  buyerSellerRatio?: number;
  liquidityScore?: number;
  isResidue?: boolean;
}

interface EnrichedRef {
  reference: string;
  buyers: number;
  sellers: number;
  buyer_seller_ratio: number;
  liquidity_score: number;
  total_mentions: number;
}

function transformRecord(raw: RawRecord, enrichedMap: Map<string, EnrichedRef>): WatchRecord {
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

  // Use enriched data if available, fallback to raw
  const enriched = enrichedMap.get(raw.reference);
  const buyerCount = enriched?.buyers ?? raw.buyerCount ?? 0;
  const sellerCount = enriched?.sellers ?? raw.sellerCount ?? 0;
  const buyerSellerRatio = enriched?.buyer_seller_ratio ?? raw.buyerSellerRatio ?? 0;
  const liquidityScore = enriched?.liquidity_score ?? raw.liquidityScore ?? 0;

  // Compute real seller rating proxy from liquidity + market presence
  // If no enriched data, use a lower score to indicate uncertainty
  let sellerRating = raw.sellerRating ?? 0;
  if (sellerRating === 0 || sellerRating === 4) {
    // Derive from liquidity score (0-100) mapped to 1-5 stars
    if (liquidityScore > 0) {
      sellerRating = Math.min(5, Math.max(1, Math.round(liquidityScore / 20)));
    } else if (buyerCount + sellerCount > 0) {
      sellerRating = Math.min(5, Math.max(1, Math.round((buyerCount + sellerCount) / 200)));
    } else {
      sellerRating = 0; // truly unknown
    }
  }

  // Use price directly since priceUSD is missing in the JSON
  const effectivePrice = raw.priceUSD || raw.price || 0;

  // Currency detection from raw message if price seems off or missing
  let originalCurrency = raw.currency || 'USD';
  let originalPrice = raw.price || 0;
  let finalPrice = effectivePrice;
  const currencyInfo = raw.sourceLine ? detectCurrency(raw.sourceLine) : null;
  if (currencyInfo && currencyInfo.usdAmount > 0) {
    originalCurrency = currencyInfo.currency;
    originalPrice = currencyInfo.originalAmount;
    finalPrice = currencyInfo.usdAmount;
  }

  // Calculate price variance
  const priceVariance = finalPrice > 0 
    ? ((raw.mlPredictedPrice - finalPrice) / finalPrice) * 100 
    : 0;

  return {
    id: raw.id,
    source: sourceMap[raw.sourceType] || 'whatsapp',
    rawMessage: raw.sourceLine || '',
    timestamp: raw.timestamp || '',
    brand: raw.brand || 'Unknown',
    reference: normalizeReference(raw.reference, raw.brand),
    family: raw.family || 'Other',
    price: finalPrice,
    originalPrice: originalPrice,
    originalCurrency: originalCurrency,
    dialColor: normalizeDialColor(raw.dialColor || raw.dial || 'UNKNOWN'),
    condition: raw.condition || 'Unknown',
    hasBox,
    hasPapers,
    year: raw.year,
    sellerRating,
    daysOnMarket: raw.daysOnMarket || 0,
    confidence: raw.confidence || 0,
    mlPredictedPrice: raw.mlPredictedPrice || 0,
    priceVariance: Math.round(priceVariance * 100) / 100,
    demandForecast: raw.mlDemandForecast || 'STABLE',
    outcomeClassification: raw.mlOutcomeClass || 'HOLD',
    marketComparables: raw.marketComparables || 0,
    processingTime: raw.stageLogs ? raw.stageLogs.length * 300 : 1500,
    pipelineLog,
    isResidue: raw.isResidue ?? (raw.status === 'RESIDUE'),
    failureFlags: raw.flags || [],
    severity,
    imageUrl: raw.imageUrl || null,
    imageCount: raw.imageCount || 0,
    imageConfirmed: raw.imageConfirmed || false,
    autoResolvedFlags: raw.autoResolvedFlags || [],
    buyerCount,
    sellerCount,
    buyerSellerRatio,
    liquidityScore,
  };
}

export function useWatchData() {
  const [records, setRecords] = useState<WatchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/parsedWatches.json').then((res) => {
        if (!res.ok) throw new Error(`parsedWatches.json HTTP ${res.status}`);
        return res.json();
      }),
      fetch('/enriched_refs.json').then((res) => {
        if (!res.ok) throw new Error(`enriched_refs.json HTTP ${res.status}`);
        return res.json();
      }).catch(() => [] as EnrichedRef[]),
    ])
      .then(([rawData, enrichedData]: [RawRecord[], EnrichedRef[]]) => {
        const enrichedMap = new Map<string, EnrichedRef>();
        enrichedData.forEach((e) => {
          if (e.reference) enrichedMap.set(e.reference, e);
        });
        const transformed = rawData.map((r) => transformRecord(r, enrichedMap));
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
    throughputRate: Math.round(records.length / 2.4),
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
