/**
 * TELEGRAM BOT WEBHOOK API
 * /api/telegram-bot
 *
 * Handles Telegram bot commands for owner alerts and stats.
 * Commands: /stats, /search, /alert
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = 'https://api.telegram.org/bot';

async function sendMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  await fetch(`${TELEGRAM_API}${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

async function getStats() {
  try {
    const res = await fetch('https://watchfacts-poc.vercel.app/parsedWatches.json');
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];

    let approved = 0, human = 0, recycle = 0;
    for (const row of rows) {
      const status = row[10] || '';
      if (status === 'APPROVED') approved++;
      else if (status === 'HUMAN') human++;
      else if (status === 'RECYCLE') recycle++;
    }

    return {
      total: rows.length,
      approved,
      human,
      recycle,
    };
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', bot: !!TELEGRAM_BOT_TOKEN });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // Handle Telegram webhook update
  if (body.message) {
    const chatId = body.message.chat.id;
    const text = body.message.text || '';
    const command = text.split(' ')[0];

    switch (command) {
      case '/stats': {
        const stats = await getStats();
        if (!stats) {
          await sendMessage(chatId, '\u274c Failed to load stats. Try again later.');
          break;
        }
        const msg = `
*WatchFacts Stats*

📊 Total: ${stats.total.toLocaleString()}
✅ Approved: ${stats.approved.toLocaleString()} (${Math.round((stats.approved/stats.total)*100)}%)
👥 Human Review: ${stats.human.toLocaleString()} (${Math.round((stats.human/stats.total)*100)}%)
♻️ Recycle: ${stats.recycle.toLocaleString()} (${Math.round((stats.recycle/stats.total)*100)}%)

[Open Dashboard](https://watchfacts-poc.vercel.app/#/admin)
        `.trim();
        await sendMessage(chatId, msg);
        break;
      }

      case '/search': {
        const query = text.slice(8).trim();
        if (!query) {
          await sendMessage(chatId, '🔍 Usage: `/search 5712/1A` or `/search Patek`');
          break;
        }
        await sendMessage(chatId, `🔍 Searching for "${query}"...\n\n_Feature coming soon: search by reference or brand_`);
        break;
      }

      case '/alert': {
        await sendMessage(chatId, '🚨 Alert settings:\n\n_Feature coming soon: configure alerts for new HUMAN reviews_');
        break;
      }

      case '/start':
      case '/help':
      default: {
        const help = `
*WatchFacts Bot Commands*

/stats — Current database stats
/search <ref> — Search by reference
/alert — Configure alerts
/help — Show this message

[Open Admin Panel](https://watchfacts-poc.vercel.app/#/admin)
        `.trim();
        await sendMessage(chatId, help);
        break;
      }
    }

    return res.status(200).json({ ok: true });
  }

  // Handle manual trigger (for cron jobs)
  if (body.action === 'alert-owner') {
    const stats = await getStats();
    if (stats && stats.human > 0) {
      const msg = `
⚠️ *Daily Alert*

${stats.human} records need human review.
${stats.recycle} records in recycle bin.

[Review Now](https://watchfacts-poc.vercel.app/#/review)
      `.trim();
      await sendMessage(body.chatId, msg);
    }
    return res.status(200).json({ sent: true });
  }

  return res.status(200).json({ ok: true });
}
