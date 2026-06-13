export default function handler(req, res) {
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;
  
  res.status(200).json({
    claude: claudeKey ? `present (${claudeKey.length} chars)` : 'missing',
    gemini: geminiKey ? `present (${geminiKey.length} chars)` : 'missing',
    google: googleKey ? `present (${googleKey.length} chars)` : 'missing',
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });
}
