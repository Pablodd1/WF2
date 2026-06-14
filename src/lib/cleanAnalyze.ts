/**
 * Client for /api/pipeline-parse — individualized, fully-visible watch analysis.
 * Paste 1..N watch descriptions. Each watch is returned with its full stage-by-stage
 * workflow plus a single-gate verdict (APPROVED / HUMAN / RECYCLE).
 */

export type Verdict = 'APPROVED' | 'HUMAN' | 'RECYCLE';
export type StageName = 'PARSE' | 'AI_TEXT' | 'CATALOG' | 'IQR' | 'CURRENCY';

export interface CleanStage {
  stage: StageName;
  engine: string;
  confidence: number;
  data?: Record<string, any>;
  verdict?: 'MATCH' | 'MISMATCH' | 'UNVERIFIED';
  note?: string;
  error?: string;
}

export interface CleanParsed {
  brand: string;
  reference: string;
  family: string;
  dialColor: string;
  condition: string;
  year: number | null;
  price: number;
  currency: string;
  priceUSD: number;
  materials: string[];
}

export interface CleanWatch {
  input: string;
  parsed: CleanParsed;
  confidence: number;
  verdict: Verdict;
  reason: string;
  flags: string[];
  stages: CleanStage[];
}

export interface CleanSummary {
  total: number;
  approved: number;
  human: number;
  recycle: number;
  threshold: number;
}

export interface CleanResponse {
  success: boolean;
  summary: CleanSummary;
  watches: CleanWatch[];
  error?: string;
}

export async function cleanAnalyze(text: string): Promise<CleanResponse> {
  try {
    const res = await fetch('/api/pipeline-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, summary: { total: 0, approved: 0, human: 0, recycle: 0, threshold: 85 }, watches: [], error: data.error || `HTTP ${res.status}` };
    }
    return data;
  } catch (e: any) {
    return { success: false, summary: { total: 0, approved: 0, human: 0, recycle: 0, threshold: 85 }, watches: [], error: e.message };
  }
}
