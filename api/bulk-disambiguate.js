/**
 * BULK DISAMBIGUATION ENDPOINT
 * POST /api/bulk-disambiguate
 *
 * Uses GPT-4o-mini to batch-disambiguate partial references.
 * Processes 20 records per API call to minimize cost.
 *
 * POST body:
 *   { records: [{ id, reference, brand, dial, source? }], useWebSearch?: bool }
 *
 * Returns:
 *   { resolved: [{ id, originalRef, resolvedRef, model, year, confidence, notes }] }
 *
 * Cost: ~$0.001 per 20 records (gpt-4o-mini @ $0.15/1M input)
 */

const BATCH_SIZE = 20;

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

  const { records = [], useWebSearch = false } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }

  const resolved = [];
  const errors = [];
  let totalTokens = 0;
  let totalCost = 0;

  // Process in batches
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    try {
      const inputData = batch.map(r => ({
        id: r.id,
        reference: r.reference,
        brand: r.brand,
        dial: r.dial || null,
        source: (r.source || '').slice(0, 200),
      }));

      const systemPrompt = useWebSearch
        ? `You are a luxury watch expert with access to web search. For each partial/ambiguous reference below, use your knowledge AND optionally search to find the canonical full reference. Watch naming conventions:
- Rolex 126xxx/116xxx = 6-digit + 1-4 letter suffix (e.g., 126610LV = Submariner Date "Hulk")
- Rolex 6-digit refs with suffix (LN=Black, LV=Green, LB=Blue, BLNR=Batman, BLRO=Pepsi)
- Patek 5xxx/xxxx = 4-digit + slash + 1-4 letters (e.g., 5712/1A = Nautilus Moon Phase)
- Patek 5270P = Annual Calendar Chronograph Platinum
- Patek 5167A, 5935A = Annual Calendar Steel, Chronograph Steel
- RM 11-01/02/03/04 = Felipe Massa editions (RM 11-03 most common 2024)
- RM 67-01/02 = Sprint ladies editions
- AP 15500ST, 15510ST, 16202ST = Royal Oak variants
- VC 336xxx = Overseas collection

Return JSON array with same id, fields:
{ "id": "...", "resolved_ref": "5712/1A", "model": "Nautilus Moon Phase", "year": 2024, "confidence": 0.95, "notes": "canonical full ref" }
If the reference is already complete and correct, set confidence=1.0.`
        : `You are a luxury watch expert. For each partial/ambiguous reference, identify the most likely canonical full reference. Use your training data only.

Watch naming conventions:
- Rolex 6-digit + 1-4 letters (LN=Black, LV=Green, LB=Blue, BLNR=Batman, BLRO=Pepsi)
- Patek 4-digit + slash + letters (5270P, 5167A, 5935A, 5712/1A)
- RM 11-03 (most common 2024 Felipe Massa)
- AP 15500ST/15510ST/16202ST
- VC 336xxx Overseas

Return JSON array with same id, fields:
{ "id": "...", "resolved_ref": "5712/1A", "model": "Nautilus Moon Phase", "year": 2024, "confidence": 0.95, "notes": "..." }
If reference is already complete, set confidence=1.0.`;

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(inputData) },
          ],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        errors.push({ batch_start: i, error: `OpenAI HTTP ${resp.status}: ${errText.slice(0, 200)}` });
        continue;
      }

      const data = await resp.json();
      totalTokens += data.usage?.total_tokens || 0;
      // gpt-4o-mini: $0.15/1M input, $0.60/1M output
      totalCost += ((data.usage?.prompt_tokens || 0) * 0.15 + (data.usage?.completion_tokens || 0) * 0.60) / 1_000_000;

      // Parse response - should be a JSON object with "results" or "resolved" array
      const content = data.choices?.[0]?.message?.content || '{}';
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        errors.push({ batch_start: i, error: `JSON parse: ${content.slice(0, 200)}` });
        continue;
      }

      // Find the array of results — try common shapes
      let results = [];
      if (Array.isArray(parsed)) {
        results = parsed;
      } else {
        // Look for any array property
        for (const key of Object.keys(parsed)) {
          if (Array.isArray(parsed[key])) {
            results = parsed[key];
            break;
          }
        }
      }
      for (const r of results) {
        resolved.push({
          id: r.id,
          originalRef: batch.find(b => b.id === r.id)?.reference,
          resolvedRef: r.resolved_ref || r.reference || r.ref || r.resolvedRef,
          model: r.model || null,
          year: r.year || null,
          confidence: r.confidence || 0,
          notes: r.notes || '',
        });
      }
    } catch (e) {
      errors.push({ batch_start: i, error: e.message });
    }
  }

  return res.status(200).json({
    success: true,
    total: records.length,
    resolved: resolved.length,
    errors: errors.length,
    totalTokens,
    estimatedCost: Math.round(totalCost * 10000) / 10000,
    resolved_records: resolved,
    errors_detail: errors,
  });
};
