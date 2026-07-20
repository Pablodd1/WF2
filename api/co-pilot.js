/**
 * AI CO-PILOT ENDPOINT
 * POST /api/co-pilot
 *
 * For records the parser couldn't handle (confidence < 60),
 * the human reviewer asks the AI co-pilot to interpret the raw message.
 *
 * Returns:
 *   - best guess for brand, ref, dial, price, etc.
 *   - 2-3 alternative interpretations if ambiguous
 *   - ambiguities the human should double-check
 *
 * Body: { rawMessage, currentGuess? }
 */

const { ZERO_HALLUCINATION_NORMALIZATION_CONTRACT } = require('./_lib/ai-normalization-contract.cjs');
const { consumeAiQuota, rejectForQuota } = require('./_lib/ai-quota.cjs');
const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

const REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    brand: { type: 'STRING', nullable: true },
    reference: { type: 'STRING', nullable: true },
    dialColor: { type: 'STRING', nullable: true },
    condition: { type: 'STRING', nullable: true },
    year: { type: 'INTEGER', nullable: true },
    price: { type: 'NUMBER', nullable: true },
    currency: { type: 'STRING', nullable: true },
    confidence: { type: 'INTEGER' },
    interpretations: { type: 'ARRAY', items: { type: 'STRING' } },
    ambiguities: { type: 'ARRAY', items: { type: 'STRING' } },
    reasoning: { type: 'STRING' },
  },
  required: ['brand', 'reference', 'dialColor', 'condition', 'year', 'price', 'currency', 'confidence', 'interpretations', 'ambiguities', 'reasoning'],
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const dealerAuth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (dealerAuth.error) return res.status(dealerAuth.status).json({ error: dealerAuth.error });

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Gemini review assistance is not configured' });
  }

  const { rawMessage, currentGuess } = req.body || {};
  const boundedRawMessage = String(rawMessage || '').trim().slice(0, 12_000);
  if (!boundedRawMessage) {
    return res.status(400).json({ error: 'rawMessage required' });
  }

  const quota = await consumeAiQuota(req, { route: 'co-pilot', limit: 10 });
  if (!quota.allowed) return rejectForQuota(res, quota);

  const systemPrompt = `You are a luxury watch co-pilot helping a human reviewer fix a record the parser couldn't fully understand.

Your job:
1. Extract only what the dealer message explicitly supports
2. If multiple interpretations exist, give the 2-3 most likely
3. Highlight ambiguities the human should double-check
4. Use your knowledge of:
   - Rolex 6-digit refs with LN/LV/LB/BLNR/BLRO suffixes
   - Patek 5xxx/xxxx slash refs (5270P, 5167A, 5935A, 5712/1A, etc.)
   - RM 11-01/02/03/04 Felipe Massa (RM 11-03 most common 2024)
   - AP 15500ST/15510ST/16202ST Royal Oak variants
   - VC 336xxx Overseas
   - Common emoji: 🔵 Patek, 🔴 AP, 🟢 Rolex, ⚫ Submariner

Return JSON with:
{
  "brand": "most likely brand",
  "reference": "most likely canonical reference",
  "dialColor": "most likely dial color",
  "condition": "New/Used/Like New",
  "year": number or null,
  "price": number or null,
  "currency": "USD/HKD/etc." or null,
  "confidence": 0-100,
  "interpretations": ["interpretation 1", "interpretation 2", "interpretation 3"],
  "ambiguities": ["thing to double-check 1", "thing 2"],
  "reasoning": "cite the exact raw evidence; identify unsupported fields"
}

${ZERO_HALLUCINATION_NORMALIZATION_CONTRACT}`;

  const boundedGuess = currentGuess && typeof currentGuess === 'object'
    ? {
        brand: currentGuess.brand || null,
        reference: currentGuess.reference || null,
        dialColor: currentGuess.dialColor || null,
        condition: currentGuess.condition || null,
        price: currentGuess.price || null,
        currency: currentGuess.currency || null,
      }
    : null;
  const userPrompt = boundedGuess
    ? `Raw dealer message: "${boundedRawMessage}"\n\nCurrent deterministic candidate: ${JSON.stringify(boundedGuess)}\n\nHelp the human verify or correct this. Catalog approval is handled separately and must not be claimed.`
    : `Raw dealer message: "${boundedRawMessage}"\n\nHelp the human reviewer identify only explicitly supported fields. Catalog approval is handled separately.`;

  try {
    const model = process.env.GEMINI_REVIEW_MODEL || 'gemini-2.5-flash';
    const aiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: REVIEW_SCHEMA,
        },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return res.status(500).json({
        success: false,
        error: `Gemini HTTP ${aiResp.status}: ${errText.slice(0, 200)}`,
      });
    }

    const data = await aiResp.json();
    const content = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '{}';
    const parsed = JSON.parse(content);

    return res.status(200).json({
      success: true,
      copilot: parsed,
      tokens: data.usageMetadata?.totalTokenCount || 0,
      model,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
};
