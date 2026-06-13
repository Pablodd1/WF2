/**
 * AI parser fallback using Kimi K2.6 API
 * OpenAI-compatible endpoint at api.moonshot.ai
 */

const KIMI_API_URL = 'https://api.moonshot.ai/v1/chat/completions';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { rawMessage, currentGuess } = req.body;
  if (!rawMessage || typeof rawMessage !== 'string') {
    return res.status(400).json({ error: 'rawMessage (string) required' });
  }

  const kimiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!kimiKey && !claudeKey && !geminiKey) {
    return res.status(500).json({
      error: 'No AI API key configured. Set KIMI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY.',
    });
  }

  const systemPrompt = `You are a luxury watch expert parsing WhatsApp chat listings.
Extract these fields from the raw message into valid JSON:
- reference: watch reference number (e.g., "5712/1A-010", "RM07-01", "15400ST")
- dialColor: dial color in English (Blue, Black, Green, Brown, White, Silver, Grey, Pink, Purple, Yellow, Orange, Champagne, Ice Blue, Mother of Pearl, Meteorite, Diamond, Special)
- brand: one of "Patek Philippe", "Audemars Piguet", "Rolex", "Richard Mille", "Unknown"
- condition: "New", "Used", or "Unknown"
- year: 4-digit year if mentioned, else null
- price: numeric value only
- currency: "HKD", "USD", "USDT", or "EUR"

Rules:
1. Reference suffixes indicate dial color: LN=Black, LB=Blue, LV=Green, CHNR=Brown, R=Brown, G=Blue, J=Champagne, P=Blue, ST=Blue, OR=Pink, TI=Grey, BC=Black
2. If no dial color stated, infer from reference suffix
3. Return ONLY valid JSON. No markdown, no explanations, no code blocks.

Example input: "5712/1a Blue N5/2026 New 850k HKD"
Example output: {"reference":"5712/1A-010","dialColor":"Blue","brand":"Patek Philippe","condition":"New","year":2026,"price":850000,"currency":"HKD","confidence":95}`;

  const userPrompt = `Current regex guess: ${JSON.stringify(currentGuess || {})}

Raw message:
"""
${rawMessage}
"""

Return ONLY JSON:`;

  // ── Kimi K2.6 (preferred, OpenAI-compatible) ──
  if (kimiKey) {
    try {
      const response = await fetch(KIMI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${kimiKey}`,
        },
        body: JSON.stringify({
          model: 'kimi-k2.6',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 1,
          max_tokens: 8192,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[ai-parse] Kimi HTTP', response.status, errText);
      } else {
        const data = await response.json();
        const choice = data.choices?.[0];
        let content = choice?.message?.content;
        // Kimi K2.6 thinking mode fallback
        if (!content && choice?.message?.reasoning_content) {
          console.log('[ai-parse] Kimi used reasoning_content');
          content = choice.message.reasoning_content;
        }
        if (content) {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return res.status(200).json({
              success: true,
              parsed,
              source: 'kimi',
              model: 'kimi-k2.6',
            });
          }
        }
      }
    } catch (e) {
      console.error('[ai-parse] Kimi exception:', e.message);
    }
  }

  // ── Claude fallback ──
  if (claudeKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[ai-parse] Claude HTTP', response.status, errText);
      } else {
        const data = await response.json();
        const content = data.content?.[0]?.text || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.status(200).json({
            success: true,
            parsed,
            source: 'claude',
            model: 'claude-3-5-sonnet-20241022',
          });
        }
      }
    } catch (e) {
      console.error('[ai-parse] Claude exception:', e.message);
    }
  }

  // ── Gemini fallback ──
  if (geminiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
              maxOutputTokens: 512,
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error('[ai-parse] Gemini HTTP', response.status, errText);
      } else {
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.status(200).json({
            success: true,
            parsed,
            source: 'gemini',
            model: 'gemini-2.0-flash',
          });
        }
      }
    } catch (e) {
      console.error('[ai-parse] Gemini exception:', e.message);
      return res.status(500).json({ error: `Gemini API error: ${e.message}` });
    }
  }

  return res.status(500).json({ error: 'All AI providers failed' });
}
