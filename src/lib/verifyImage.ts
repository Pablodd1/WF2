/**
 * Client-side image verification using Gemini Vision API directly.
 * Avoids Vercel serverless timeout by calling Gemini from the browser.
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
  source?: 'gemini-browser';
  error?: string;
}

const VISION_PROMPT = `You are a luxury watch authentication expert. Look at this watch photo and report ONLY what you can see.

Return ONLY a JSON object with exactly these keys:
- brand (string, e.g. "Rolex" or "UNKNOWN")
- referenceVisible (string, any reference number printed on dial/case, else "UNKNOWN")
- modelGuess (string, model family if recognizable, else "UNKNOWN")
- dialColor (string, choose ONE: Black, Blue, White, Silver, Gold, Green, Grey, Brown, Pink, Purple, Red, Orange, Yellow, Champagne, Multi-color, Meteorite, Mother of Pearl, Diamond, UNKNOWN)
- hasRainbowBezel (boolean, true if rainbow-colored gem bezel visible)
- legible (boolean, false if blurry/cropped/box-only)
- confidence (number 0-100)
- notes (short string)

Be honest when unsure.`;

function normRef(s: string) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function refsAgree(textRef: string, imageRef: string): boolean | null {
  const a = normRef(textRef);
  const b = normRef(imageRef);
  if (!a || !b || b === 'UNKNOWN' || a === 'UNKNOWN') return null;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const coreA = (a.match(/\d{4,6}/) || [])[0];
  const coreB = (b.match(/\d{4,6}/) || [])[0];
  if (coreA && coreB && coreA === coreB) return true;
  return false;
}

function dialAgree(textDial: string, imageDial: string): boolean | null {
  const a = String(textDial || '').toUpperCase().trim();
  const b = String(imageDial || '').toUpperCase().trim();
  if (!a || a === 'UNKNOWN') return null;
  if (!b || b === 'UNKNOWN') return null;
  if (a === b) return true;
  const map: Record<string, string> = { 'SILVER': 'WHITE', 'CHAMPAGNE': 'WHITE', 'MOP': 'WHITE', 'MOTHER OF PEARL': 'WHITE' };
  return (map[a] || a) === (map[b] || b);
}

async function fetchImageBase64(imageUrl: string): Promise<{ base64: string; mime: string }> {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`);
  const buf = await imgRes.arrayBuffer();
  const mime = imgRes.headers.get('content-type') || 'image/jpeg';
  return { base64: btoa(String.fromCharCode(...new Uint8Array(buf))), mime };
}

function extractJson(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const candidates: string[] = [];
  const stack: string[] = [];
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '{') { if (stack.length === 0) start = i; stack.push(c); }
    else if (c === '}') {
      stack.pop();
      if (stack.length === 0 && start >= 0) { candidates.push(cleaned.slice(start, i + 1)); start = -1; }
    }
  }
  for (let k = candidates.length - 1; k >= 0; k--) {
    const cand = candidates[k];
    if (!/"(brand|dialColor|referenceVisible|legible)"/.test(cand)) continue;
    try { return JSON.parse(cand); } catch (e) { /* try next */ }
  }
  return null;
}

export async function verifyImageReference(
  imageUrl: string,
  reference: string,
  brand?: string,
  dialColor?: string
): Promise<VerifyImageResult> {
  try {
    // Get Gemini API key from environment or prompt
    const geminiKey = (window as any).__GEMINI_API_KEY__ || '';
    if (!geminiKey) {
      // Fallback to server endpoint if no browser key
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
    }

    // Client-side Gemini Vision
    const { base64, mime } = await fetchImageBase64(imageUrl);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: VISION_PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
      }),
    });

    if (!geminiRes.ok) throw new Error(`Gemini ${geminiRes.status}: ${await geminiRes.text()}`);
    const geminiData = await geminiRes.json();
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const img = extractJson(raw);

    if (!img) {
      return { success: false, verdict: 'UNVERIFIED', flag: null, severity: 'INFO', reason: 'Could not parse vision response', error: 'Parse failed' };
    }

    // Compare with text-parsed data
    const discrepancies: string[] = [];
    let verdict: 'MATCH' | 'MISMATCH' | 'UNVERIFIED' = 'UNVERIFIED';
    let severity: 'CRITICAL' | 'WARNING' | 'INFO' = 'INFO';
    let reason = '';

    const refAgree = reference ? refsAgree(reference, img.referenceVisible) : null;
    const dialAg = dialColor ? dialAgree(dialColor, img.dialColor) : null;

    const tb = (brand || '').toUpperCase().replace(/[^A-Z]/g, '');
    const ib = (img.brand || '').toUpperCase().replace(/[^A-Z]/g, '');
    const brandKnown = tb && ib && ib !== 'UNKNOWN' && tb !== 'UNKNOWN';
    const brandConflict = brandKnown && !(tb.startsWith(ib.slice(0, 4)) || ib.startsWith(tb.slice(0, 4)));

    if (img.legible === false || (img.confidence ?? 0) < 40) {
      verdict = 'UNVERIFIED';
      reason = 'Image not clear enough to verify.';
    } else if (brandConflict || refAgree === false || dialAg === false) {
      verdict = 'MISMATCH';
      severity = 'CRITICAL';
      if (brandConflict) discrepancies.push(`Brand: text says "${brand}", image shows "${img.brand}"`);
      if (refAgree === false) discrepancies.push(`Reference: text says "${reference}", image shows "${img.referenceVisible}"`);
      if (dialAg === false) discrepancies.push(`Dial: text says "${dialColor}", image shows "${img.dialColor}"`);
      reason = `Discrepancies found: ${discrepancies.join('; ')}`;
    } else if (refAgree === true && dialAg === true) {
      verdict = 'MATCH';
      reason = `Image confirms reference "${img.referenceVisible}" and dial "${img.dialColor}" match text extraction.`;
    } else if (brandKnown && !brandConflict && dialAg === true) {
      verdict = 'MATCH';
      reason = `Image confirms brand "${img.brand}" and dial "${img.dialColor}". Consistent.`;
    } else {
      verdict = 'UNVERIFIED';
      reason = 'Image is clear but shows no printed reference or recognizable details to cross-check.';
    }

    return {
      success: true,
      verdict,
      severity,
      reason,
      flag: verdict === 'MISMATCH' ? 'IMAGE_MISMATCH' : null,
      textReference: reference,
      image: {
        brand: img.brand || 'UNKNOWN',
        referenceVisible: img.referenceVisible || 'UNKNOWN',
        modelGuess: img.modelGuess || 'UNKNOWN',
        dialColor: img.dialColor || 'UNKNOWN',
        legible: img.legible !== false,
        confidence: img.confidence ?? 0,
        notes: img.notes || '',
      },
      source: 'gemini-browser',
    };
  } catch (e: any) {
    return { success: false, verdict: 'UNVERIFIED', flag: null, severity: 'INFO', reason: e.message, error: e.message };
  }
}
