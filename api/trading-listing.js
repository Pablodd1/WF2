'use strict';

const { getClient } = require('./_lib/supabase');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query?.id || '').trim().slice(0, 250);
  if (!id) return res.status(400).json({ error: 'Listing id required' });

  try {
    const client = getClient();
    const { data: publicListing, error: publicError } = await client
      .from('trading_floor_listings')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (publicError) throw publicError;
    if (!publicListing) return res.status(404).json({ error: 'Listing not found' });

    const { data, error } = await client.from('watch_records')
      .select('id,raw_message,listing_date,created_at,source_type')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Listing not found' });
    return res.status(200).json({
      success: true,
      listing: {
        id: data.id,
        raw_message: redactPublicSource(data.raw_message),
        listing_date: data.listing_date,
        created_at: data.created_at,
        source_type: data.source_type,
        source_message_is_redacted: true,
      },
    });
  } catch (error) {
    console.error('[trading-listing]', error.message);
    return res.status(500).json({ error: 'Unable to load source evidence' });
  }
};
