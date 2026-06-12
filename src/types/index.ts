export type StageName = 'INGEST' | 'VALIDATE' | 'NORMALIZE' | 'ENRICH' | 'ML_SCORE';

export type FailureFlag =
  | 'YEAR_MISSING'
  | 'DIAL_UNKNOWN'
  | 'INCOMPLETE_REFERENCE'
  | 'BOXPAPERS_UNKNOWN'
  | 'LOW_SELLER_RATING'
  | 'PRICE_OUTLIER'
  | 'BRAND_UNCERTAIN'
  | 'CURRENCY_MISMATCH';

export interface PipelineStage {
  name: StageName;
  status: 'pending' | 'active' | 'completed' | 'failed';
  message: string;
  timestamp: number;
}

export interface WatchRecord {
  id: string;
  source: 'whatsapp' | 'websocket' | 'csv';
  rawMessage: string;
  timestamp: string;
  brand: string;
  reference: string;
  family: 'Nautilus' | 'Aquanaut' | 'Calatrava' | 'Grand Complications' | 'Complications' | 'Gondolo' | 'Twenty-4' | 'Other';
  price: number;
  originalPrice: number;
  originalCurrency: 'USD' | 'HKD' | 'EUR' | 'GBP';
  dialColor: string;
  condition: 'New' | 'Used' | 'Like New' | 'Naked';
  hasBox: boolean;
  hasPapers: boolean;
  year: number | null;
  sellerRating: number;
  daysOnMarket: number;
  confidence: number;
  mlPredictedPrice: number;
  priceVariance: number;
  demandForecast: 'HIGH' | 'RISING' | 'STABLE' | 'LOW' | 'DECLINING';
  outcomeClassification: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'PASS' | 'REVIEW';
  marketComparables: number;
  processingTime: number;
  pipelineLog: PipelineStage[];
  isResidue: boolean;
  failureFlags: FailureFlag[];
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
}

export interface DashboardState {
  records: WatchRecord[];
  currentTheaterRecord: WatchRecord | null;
  theaterStage: number;
  filters: {
    search: string;
    brands: string[];
    priceMin: number;
    priceMax: number;
    conditions: string[];
    currencies: string[];
    confidenceMin: number;
  };
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
  selectedRecord: WatchRecord | null;
  detailModalOpen: boolean;
  editModalOpen: boolean;
  editingRecord: WatchRecord | null;
  residueBinOpen: boolean;
}
