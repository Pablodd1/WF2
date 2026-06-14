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

Return ONLY this JSON:
{"brand":"<brand or UNKNOWN>","referenceVisible":"<any reference number printed on the watch/papers, or UNKNOWN>","modelGuess":"<model family if recognizable, else UNKNOWN>","dialColor":"<color>","legible":<true|false>,"confidence":<0-100>,"notes":"<short note>"}

Set "legible": false if the image is blurry, cropped, a box/strap only, or otherwise not a clear watch face. Be honest when unsure.`;

async function fetchImageBase64(imageUrl) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const mime = imgRes.headers.get('content-type') || 'image/jpeg';
  return { base64: buf.toString('base64'), mime };
}

function extractJson(text) {
  const m = (text || '').match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
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

    // Decide verdict.
    let verdict, flag = null, severity = 'INFO', reason;
    if (img.legible === false || (img.confidence ?? 0) < 40) {
      verdict = 'UNVERIFIED';
      reason = 'Image not clear enough to verify the reference (blurry/cropped/box-only).';
    } else {
      const agree = refsAgree(reference, img.referenceVisible);
      const brandAgree =
        !brand || !img.brand || img.brand === 'UNKNOWN'
          ? null
          : normRef(brand).slice(0, 5) === normRef(img.brand).slice(0, 5) ||
            (brand || '').toUpperCase().includes((img.brand || '').toUpperCase().split(' ')[0]);

      if (agree === true) {
        verdict = 'MATCH';
        reason = `Image reference "${img.referenceVisible}" agrees with text reference "${reference}".`;
      } else if (agree === false || brandAgree === false) {
        verdict = 'MISMATCH';
        flag = 'IMAGE_MISMATCH';
        severity = 'CRITICAL';
        reason = `Image shows ${img.brand || 'a different watch'}${img.referenceVisible && img.referenceVisible !== 'UNKNOWN' ? ` ref "${img.referenceVisible}"` : ''} but text claims reference "${reference}".`;
      } else {
        // Image legible but no reference printed — fall back to dial-color sanity only.
        verdict = 'UNVERIFIED';
        reason = 'Image is clear but shows no printed reference to cross-check.';
      }
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
