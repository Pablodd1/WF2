const { getClient } = require('./_lib/supabase');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.query?.id || '').trim();
  if (!id || id.length > 250) return res.status(400).json({ error: 'Valid listing id required' });

  try {
    const client = getClient();
    const { data: listing, error: listingError } = await client
      .from('watch_records').select('id,brand,reference,dealer_id').eq('id', id).maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (!listing.dealer_id) return res.status(200).json({ success: true, contact_available: false, reason: 'DEALER_UNRESOLVED' });

    const { data: dealer, error: dealerError } = await client
      .from('dealers').select('id,display_name,status,contact_consent').eq('id', listing.dealer_id).maybeSingle();
    if (dealerError) throw dealerError;
    if (!dealer || dealer.status !== 'VERIFIED' || !dealer.contact_consent) {
      return res.status(200).json({ success: true, contact_available: false, reason: 'CONTACT_NOT_VERIFIED' });
    }

    const { data: identities, error: identityError } = await client
      .from('dealer_source_identities')
      .select('source_identity,identity_type,verification_status')
      .eq('dealer_id', dealer.id).eq('verification_status', 'VERIFIED')
      .in('identity_type', ['PHONE', 'WHATSAPP', 'phone', 'whatsapp']).limit(10);
    if (identityError) throw identityError;
    const phone = (identities || []).map(item => normalizePhone(item.source_identity)).find(Boolean);
    if (!phone) return res.status(200).json({ success: true, contact_available: false, reason: 'VERIFIED_PHONE_UNAVAILABLE' });

    const item = [listing.brand, listing.reference].filter(Boolean).join(' ');
    const message = encodeURIComponent(`Hello, I am interested in the ${item || 'luxury listing'} shown on Curated Luxury. Is it still available?`);
    return res.status(200).json({
      success: true,
      contact_available: true,
      dealer_name: dealer.display_name || 'Verified dealer',
      whatsapp_url: `https://wa.me/${phone}?text=${message}`,
    });
  } catch (error) {
    console.error('[listing-contact]', error.message);
    return res.status(500).json({ error: 'Unable to verify dealer contact' });
  }
};
