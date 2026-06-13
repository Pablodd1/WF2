/**
 * WhatsApp Real-Time Ingest Endpoint
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join('/tmp', 'live_messages.json');

function ensureDataFile() {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}

function loadData() {
    ensureDataFile();
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}

function saveData(data) {
    ensureDataFile();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

module.exports = function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const data = loadData();
        return res.status(200).json({
            count: data.length,
            latest: data.slice(-20),
            status: 'ok'
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const record = req.body;
    if (!record || !record.rawMessage) {
        return res.status(400).json({ error: 'Missing rawMessage' });
    }

    const enriched = {
        ...record,
        id: `live_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        receivedAt: new Date().toISOString(),
        source: 'whatsapp_live',
        status: record.confidence >= 75 ? 'auto_approved' : record.confidence >= 60 ? 'ai_review' : 'human_review',
    };

    const data = loadData();
    data.push(enriched);
    if (data.length > 5000) data.shift();
    saveData(data);

    return res.status(200).json({
        success: true,
        id: enriched.id,
        status: enriched.status,
        message: `Recorded. ${enriched.status === 'auto_approved' ? 'Auto-approved.' : 'Queued for review.'}`
    });
};
