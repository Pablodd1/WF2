/**
 * MULTIMODAL IMAGE VERIFICATION API
 * /api/image-verify
 *
 * Sends listing image to AI Vision (Gemini Flash → Kimi K2.6 fallback)
 * to independently identify dial color, brand, and reference.
 * Compares visual results with text-parsed results to flag discrepancies.
 */

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';

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

Be honest when unsure. Example: {"brand":"Rolex","referenceVisible":"116610LN","modelGuess":"Submariner","dialColor":"Black","hasRainbowBezel":false,"legible":true,"confidence":92,"notes":"clear dial, date window visible"}`;

function normRef(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function refsAgree(textRef, imageRef) {
  const a = normRef(textRef);
  const b = normRef(imageRef);
  if (!a || !b || b === 'UNKNOWN' || a === 'UNKNOWN' || b === 'NA' || b === 'NONE') return null;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const coreA = (a.match(/\d{4,6}/) || [])[0];
  const coreB = (b.match(/\d{4,6}/) || [])[0];
  if (coreA && coreB && coreA === coreB) return true;
  return false;
}

function dialAgree(textDial, imageDial) {
  const a = String(textDial || '').toUpperCase().trim();
  const b = String(imageDial || '').toUpperCase().trim();
  if (!a || a === 'UNKNOWN') return null;
  if (!b || b === 'UNKNOWN') return null;
  if (a === b) return true;
  // Map close equivalents
  const map = { 'SILVER': 'WHITE', 'CHAMPAGNE': 'WHITE', 'MOP': 'WHITE', 'MOTHER OF PEARL': 'WHITE', 'MOTHER-OF-PEARL': 'WHITE' };
  const ma = map[a] || a;
  const mb = map[b] || b;
  return ma === mb;
}

async function fetchImageBase64(imageUrl) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const mime = imgRes.headers.get('content-type') || 'image/jpeg';
  return { base64: buf.toString('base64'), mime };
}

function repairJson(raw) {
  return raw
    .replace(/:\s*<true\|false>/gi, ': false')
    .replace(/:\s*<(\d+)[^>]*>/g, ': $1')
    .replace(/:\s*<[^>"]*>/g, ': "UNKNOWN"')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']');
}

function extractJson(text) {
  if (!text) return null;
  const candidates = [];
  const stack = [];
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { if (stack.length === 0) start = i; stack.push(c); }
    else if (c === '}') {
      stack.pop();
      if (stack.length === 0 && start >= 0) { candidates.push(text.slice(start, i + 1)); start = -1; }
    }
  }
  for (let k = candidates.length - 1; k >= 0; k--) {
    const cand = candidates[k];
    if (!/"(brand|dialColor|referenceVisible|legible)"/.test(cand)) continue;
    for (const attempt of [cand, repairJson(cand)]) {
      try { return JSON.parse(attempt); } catch (e) { /* try next */ }
    }
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(repairJson(m[0])); } catch (e) { /* noop */ } }
  return null;
}

async function visionGemini(key, base64, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: VISION_PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return { parsed: extractJson(d.candidates?.[0]?.content?.parts?.[0]?.text || ''), source: 'gemini' };
}

async function visionKimi(key, base64, mime) {
  const r = await fetch(KIMI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'kimi-k2.6',
      temperature: 1,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: 'You are a luxury watch authentication expert. Return ONLY valid JSON.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Kimi ${r.status}: ${await r.text()}`);
  const d = await r.json();
  const choice = d.choices?.[0]?.message;
  const rawText = choice?.content || choice?.reasoning_content || '';
  return { parsed: extractJson(rawText), source: 'kimi', raw: rawText };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageUrl, textParsed } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  if (!geminiKey && !kimiKey) return res.status(500).json({ error: 'No vision key configured' });

  try {
    const { base64, mime } = await fetchImageBase64(imageUrl);

    let vision;
    if (geminiKey) {
      try { vision = await visionGemini(geminiKey, base64, mime); }
      catch (e) { console.error('[image-verify] gemini failed:', e.message); }
    }
    if (!vision?.parsed && kimiKey) {
      vision = await visionKimi(kimiKey, base64, mime);
    }
    if (!vision?.parsed) {
      return res.status(502).json({ error: 'Vision providers returned no parseable result', rawSample: (vision?.raw || '').slice(0, 300) });
    }

    const img = vision.parsed;

    // Compare with text-parsed data
    const discrepancies = [];
    let verdict = 'UNVERIFIED';
    let severity = 'INFO';
    let reason = '';

    const refAgree = textParsed?.reference ? refsAgree(textParsed.reference, img.referenceVisible) : null;
    const dialAg = textParsed?.dialColor ? dialAgree(textParsed.dialColor, img.dialColor) : null;

    const tb = (textParsed?.brand || '').toUpperCase().replace(/[^A-Z]/g, '');
    const ib = (img.brand || '').toUpperCase().replace(/[^A-Z]/g, '');
    const brandKnown = tb && ib && ib !== 'UNKNOWN' && tb !== 'UNKNOWN';
    const brandConflict = brandKnown && !(tb.startsWith(ib.slice(0, 4)) || ib.startsWith(tb.slice(0, 4)));

    if (img.legible === false || (img.confidence ?? 0) < 40) {
      verdict = 'UNVERIFIED';
      reason = 'Image not clear enough to verify.';
    } else if (brandConflict || refAgree === false || dialAg === false) {
      verdict = 'MISMATCH';
      severity = 'CRITICAL';
      if (brandConflict) discrepancies.push(`Brand: text says "${textParsed.brand}", image shows "${img.brand}"`);
      if (refAgree === false) discrepancies.push(`Reference: text says "${textParsed.reference}", image shows "${img.referenceVisible}"`);
      if (dialAg === false) discrepancies.push(`Dial: text says "${textParsed.dialColor}", image shows "${img.dialColor}"`);
      reason = `Discrepancies found: ${discrepancies.join('; ')}`;
    } else if (refAgree === true && dialAg === true) {
      verdict = 'MATCH';
      reason = `Image confirms reference "${img.referenceVisible}" and dial "${img.dialColor}" match text extraction.`;
    } else if (brandKnown && !brandConflict && dialAg === true) {
      verdict = 'MATCH';
      reason = `Image confirms brand "${img.brand}" and dial "${img.dialColor}". No printed reference visible to cross-check exact ref, but consistent.`;
    } else {
      verdict = 'UNVERIFIED';
      reason = 'Image is clear but shows no printed reference or recognizable details to cross-check.';
    }

    return res.status(200).json({
      success: true,
      verdict,
      severity,
      reason,
      discrepancies,
      textParsed: textParsed || null,
      image: {
        brand: img.brand || 'UNKNOWN',
        referenceVisible: img.referenceVisible || 'UNKNOWN',
        modelGuess: img.modelGuess || 'UNKNOWN',
        dialColor: img.dialColor || 'UNKNOWN',
        hasRainbowBezel: img.hasRainbowBezel || false,
        legible: img.legible !== false,
        confidence: img.confidence ?? 0,
        notes: img.notes || '',
      },
      source: vision.source,
    });
  } catch (e) {
    console.error('[image-verify]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
