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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not set in Vercel env' });
  }

  const { rawMessage, currentGuess } = req.body || {};
  if (!rawMessage) {
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

  const userPrompt = currentGuess
    ? `Raw dealer message: "${rawMessage}"\n\nCurrent parser guess: ${JSON.stringify(currentGuess)}\n\nHelp the human verify or correct this.`
    : `Raw dealer message: "${rawMessage}"\n\nWhat watch is this? Help the human reviewer fill in the fields.`;

  try {
    const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      return res.status(500).json({
        success: false,
        error: `OpenAI HTTP ${aiResp.status}: ${errText.slice(0, 200)}`,
      });
    }

    const data = await aiResp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);

    return res.status(200).json({
      success: true,
      copilot: parsed,
      tokens: data.usage?.total_tokens || 0,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
};
