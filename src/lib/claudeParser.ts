/**
 * Client for Claude API fallback parsing
 * Used when regex parser yields low confidence
 */

export interface ClaudeParseResult {
  success: boolean;
  parsed?: {
    reference: string;
    dialColor: string;
    brand: string;
    condition: string;
    year: number | null;
    price: number;
    currency: string;
    confidence: number;
  };
  source: 'claude' | 'regex';
  error?: string;
}

export async function parseWithClaude(
  rawMessage: string,
  currentGuess: Record<string, any>
): Promise<ClaudeParseResult> {
  try {
    const res = await fetch('/api/claude-parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawMessage, currentGuess }),
    });

    if (!res.ok) {
      const err = await res.json();
      return { success: false, source: 'claude', error: err.error || `HTTP ${res.status}` };
    }

    const data = await res.json();
    if (!data.success || !data.parsed) {
      return { success: false, source: 'claude', error: data.error || 'Empty parse' };
    }

    return {
      success: true,
      parsed: data.parsed,
      source: 'claude',
    };
  } catch (e: any) {
    return { success: false, source: 'claude', error: e.message };
  }
}
