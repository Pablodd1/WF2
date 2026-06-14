/**
 * Client for /api/verify-image — image-vs-reference authentication check.
 * The vision model reads the photo blind, then we compare to the text reference.
 */

export interface VerifyImageResult {
  success: boolean;
  verdict: 'MATCH' | 'MISMATCH' | 'UNVERIFIED';
  flag: 'IMAGE_MISMATCH' | null;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  reason: string;
  textReference?: string;
  image?: {
    brand: string;
    referenceVisible: string;
    modelGuess: string;
    dialColor: string;
    legible: boolean;
    confidence: number;
    notes: string;
  };
  source?: 'gemini' | 'kimi';
  error?: string;
}

export async function verifyImageReference(
  imageUrl: string,
  reference: string,
  brand?: string
): Promise<VerifyImageResult> {
  try {
    const res = await fetch('/api/verify-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, reference, brand }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, verdict: 'UNVERIFIED', flag: null, severity: 'INFO', reason: data.error || `HTTP ${res.status}`, error: data.error };
    }
    return data;
  } catch (e: any) {
    return { success: false, verdict: 'UNVERIFIED', flag: null, severity: 'INFO', reason: e.message, error: e.message };
  }
}
