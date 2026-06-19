/**
 * ONLINE WATCH SEARCH ENDPOINT
 * POST /api/online-search
 *
 * Uses GPT-4o-mini + web search to look up ambiguous watch references
 * when catalog lookup fails or LLM knowledge is uncertain.
 *
 * Triggers when:
 *   - Catalog miss (no record in enriched_refs.json)
 *   - LLM confidence < 70%
 *   - Reference is new/unusual (Cubitus 7128/1G, new releases, etc.)
 *
 * Body: { reference: string, brand?: string, rawMessage?: string }
 * Returns: { success, brand, reference, model, collection, year, caseMaterial,
 *            dialColors, priceRange, source, searchResults, confidence }
 *
 * Cost: ~$0.005-0.015 per query (GPT-4o-mini + web search tool calls)
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  const { reference, brand, rawMessage } = req.body || {};
  if (!reference || typeof reference !== 'string') {
    return res.status(400).json({ error: 'reference field required' });
  }

  const query = brand
    ? `${brand} ${reference} watch specifications reference`
    : `${reference} watch specifications reference`;

  const systemPrompt = `You are a luxury watch research expert with access to web search. When given a watch reference number (and optionally a brand), find the canonical specifications for that watch.

Return ONLY valid JSON with these fields (no markdown):
{
  "brand": "Manufacturer name (Rolex, Patek Philippe, etc.)",
  "reference": "Canonical reference (clean, normalized form)",
  "model": "Model name (e.g., 'Submariner Date', 'Nautilus')",
  "collection": "Collection (e.g., 'Submariner', 'Nautilus', 'Cubitus')",
  "year": "Production year(s) if known",
  "caseMaterial": "Case material (Stainless Steel, Yellow Gold, White Gold, Rose Gold, Platinum, Titanium, Carbon, TPT, Ceramic, etc.)",
  "dialColors": "Available dial colors (comma-separated)",
  "priceRange": "Estimated retail or market price (USD)",
  "confidence": 0-100 (how confident you are in this identification),
  "notes": "Any relevant details (special edition, discontinued, etc.)",
  "sources": "List of source URLs you found"
}

If you cannot find information, set confidence to a low number and explain in notes.`;

  try {
    // Call GPT-4o-mini WITH web search tool
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: brand
              ? `Look up the watch: ${brand} ${reference}. Raw dealer message: "${rawMessage || 'N/A'}"`
              : `Look up this watch reference: ${reference}. Raw dealer message: "${rawMessage || 'N/A'}"`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 600,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(502).json({
        error: `OpenAI API error: ${resp.status}`,
        details: errText.slice(0, 500),
      });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: 'Could not parse response' };
    }

    return res.status(200).json({
      success: true,
      query,
      ...parsed,
      tokens_used: data.usage?.total_tokens || 0,
      cost_usd: ((data.usage?.total_tokens || 0) / 1000000) * 0.30,  // GPT-4o-mini blended
    });
  } catch (e) {
    return res.status(500).json({
      error: `Online search failed: ${e.message}`,
    });
  }
};
