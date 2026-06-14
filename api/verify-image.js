/**
 * Image vs Reference verification.
 *
 * The vision model reads the watch photo BLIND — it is NOT told the
 * text-extracted reference — so it can independently disagree. We then
 * compare what the image shows against what the text claimed.
 *
 * Verdict routing:
 *   MATCH      -> text reference confirmed by image
 *   MISMATCH   -> image shows a DIFFERENT watch than the text says (route to human review, CRITICAL)
 *   UNVERIFIED -> image too unclear to judge (keep text value, low confidence)
 *
 * Tries Gemini Vision first (best price/latency for vision), falls back
 * to Kimi K2.6 Vision (OpenAI-compatible, same key pool used elsewhere).
 */

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';

function normRef(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Lenient compare: exact, prefix, or shared 4+ digit core counts as match.
function refsAgree(textRef, imageRef) {
  const a = normRef(textRef);
  const b = normRef(imageRef);
  if (!a || !b) return null; // can't judge
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const coreA = (a.match(/\d{4,6}/) || [])[0];
  const coreB = (b.match(/\d{4,6}/) || [])[0];
  if (coreA && coreB && coreA === coreB) return true;
  return false;
}

const VISION_PROMPT = `You are a luxury watch authentication expert. Look at this watch photo and report ONLY what you can see — do NOT guess to match any expectation.

Return ONLY a JSON object with exactly these keys and concrete values (no angle brackets, no placeholders):
brand (string, e.g. "Rolex" or "UNKNOWN")
referenceVisible (string, any reference number printed on the watch/papers, else "UNKNOWN")
modelGuess (string, model family if recognizable, else "UNKNOWN")
dialColor (string, e.g. "Blue")
legible (boolean true or false)
confidence (number 0-100)
notes (short string)

Set legible to false if the image is blurry, cropped, a box/strap only, or otherwise not a clear watch face. Be honest when unsure. Example: {"brand":"Rolex","referenceVisible":"116610LN","modelGuess":"Submariner","dialColor":"Black","legible":true,"confidence":92,"notes":"clear dial"}`;

async function fetchImageBase64(imageUrl) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const mime = imgRes.headers.get('content-type') || 'image/jpeg';
  return { base64: buf.toString('base64'), mime };
}

function extractJson(text) {
  if (!text) return null;
  let m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let raw = m[0];
  // Repair common model artifacts: unfilled <placeholders>, trailing commas.
  raw = raw
    .replace(/:\s*<true\|false>/gi, ': false')
    .replace(/:\s*<[^>"]*>/g, ': "UNKNOWN"')      // any leftover <placeholder>
    .replace(/:\s*<(\d+)[^>]*>/g, ': $1')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']');
  try { return JSON.parse(raw); }
  catch (e) {
    try { return JSON.parse(raw.replace(/<[^>]*>/g, '"UNKNOWN"')); }
    catch (e2) { return null; }
  }
}

async function visionGemini(key, base64, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
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
      max_tokens: 1024,
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
  return { parsed: extractJson(choice?.content || choice?.reasoning_content || ''), source: 'kimi' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageUrl, reference, brand } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });
  if (!reference) return res.status(400).json({ error: 'reference required (the text-extracted value to verify)' });

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  if (!geminiKey && !kimiKey) return res.status(500).json({ error: 'No vision key (GEMINI_API_KEY or KIMI_API_KEY) configured' });

  try {
    const { base64, mime } = await fetchImageBase64(imageUrl);

    let vision;
    if (geminiKey) {
      try { vision = await visionGemini(geminiKey, base64, mime); }
      catch (e) { console.error('[verify-image] gemini failed:', e.message); }
    }
    if (!vision?.parsed && kimiKey) {
      vision = await visionKimi(kimiKey, base64, mime);
    }
    if (!vision?.parsed) return res.status(502).json({ error: 'Vision providers returned no parseable result' });

    const img = vision.parsed;

    // Decide verdict. MISMATCH only on a GENUINE conflict, never on missing data.
    let verdict, flag = null, severity = 'INFO', reason;

    const refAgree = refsAgree(reference, img.referenceVisible); // true | false | null(unknown)

    // Brand conflict: both brands known AND clearly different.
    const tb = (brand || '').toUpperCase().replace(/[^A-Z]/g, '');
    const ib = (img.brand || '').toUpperCase().replace(/[^A-Z]/g, '');
    const brandKnown = tb && ib && ib !== 'UNKNOWN' && tb !== 'UNKNOWN';
    const brandConflict = brandKnown && !(tb.startsWith(ib.slice(0, 4)) || ib.startsWith(tb.slice(0, 4)));

    if (img.legible === false || (img.confidence ?? 0) < 40) {
      verdict = 'UNVERIFIED';
      reason = 'Image not clear enough to verify (blurry, cropped, or box/strap only).';
    } else if (brandConflict || refAgree === false) {
      // Genuine disagreement -> route to human review.
      verdict = 'MISMATCH';
      flag = 'IMAGE_MISMATCH';
      severity = 'CRITICAL';
      const seen = img.brand && img.brand !== 'UNKNOWN' ? img.brand : 'a different watch';
      const seenRef = img.referenceVisible && img.referenceVisible !== 'UNKNOWN' ? ` ref "${img.referenceVisible}"` : '';
      reason = `Image shows ${seen}${seenRef}, but the listing claims ${brand || 'reference'} "${reference}".`;
    } else if (refAgree === true) {
      verdict = 'MATCH';
      reason = `Image reference "${img.referenceVisible}" agrees with listed reference "${reference}".`;
    } else if (brandKnown && !brandConflict) {
      // Brand confirmed by image, no printed reference to cross-check -> soft match.
      verdict = 'MATCH';
      reason = `Image confirms ${img.brand}${img.modelGuess && img.modelGuess !== 'UNKNOWN' ? ` ${img.modelGuess}` : ''}; no printed reference visible to verify exact ref, but brand is consistent.`;
    } else {
      verdict = 'UNVERIFIED';
      reason = 'Image is clear but shows no printed reference or recognizable brand to cross-check.';
    }

    return res.status(200).json({
      success: true,
      verdict,                 // MATCH | MISMATCH | UNVERIFIED
      flag,                    // 'IMAGE_MISMATCH' when MISMATCH, else null
      severity,                // CRITICAL on mismatch -> human review
      reason,
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
      source: vision.source,   // 'gemini' | 'kimi'
    });
  } catch (e) {
    console.error('[verify-image]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
