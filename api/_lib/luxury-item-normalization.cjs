'use strict';

const LUXURY_BRANDS = [
  ['Van Cleef & Arpels', /\b(?:van\s+cleef(?:\s*&\s*arpels)?|vca)\b/i],
  ['Louis Vuitton', /\b(?:louis\s+vuitton|lv)\b/i],
  ['Tiffany & Co.', /\btiffany(?:\s*&\s*co\.?)?\b/i],
  ['Bottega Veneta', /\bbottega\s+veneta\b/i],
  ['Harry Winston', /\bharry\s+winston\b/i],
  ['David Yurman', /\bdavid\s+yurman\b/i],
  ['Hermes', /\bherm[eèé]s\b/i],
  ['Chanel', /\bchanel\b/i],
  ['Goyard', /\bgoyard\b/i],
  ['Christian Dior', /\b(?:christian\s+)?dior\b/i],
  ['Gucci', /\bgucci\b/i],
  ['Prada', /\bprada\b/i],
  ['Fendi', /\bfendi\b/i],
  ['Bulgari', /\b(?:bulgari|bvlgari)\b/i],
  ['Cartier', /\bcartier\b/i],
  ['Chopard', /\bchopard\b/i],
  ['Graff', /\bgraff\b/i],
  ['Buccellati', /\bbuccellati\b/i],
];

const TYPE_PATTERNS = {
  HANDBAG: [
    ['Birkin', /\bbirkin\b/i], ['Kelly', /\bkelly\b/i], ['Handbag', /\bhand\s*bag\b/i],
    ['Purse', /\bpurse\b/i], ['Tote', /\btote\b/i], ['Clutch', /\bclutch\b/i],
    ['Shoulder bag', /\bshoulder\s+bag\b/i], ['Crossbody bag', /\bcrossbod(?:y|ies)\b/i],
    ['Satchel', /\bsatchel\b/i], ['Travel bag', /\b(?:duffle|travel\s+bag)\b/i],
    ['Pochette', /\bpochette\b/i],
  ],
  JEWELRY: [
    ['Necklace', /\bnecklace\b/i], ['Earrings', /\bearrings?\b/i], ['Pendant', /\bpendant\b/i],
    ['Brooch', /\bbrooch(?:es)?\b/i], ['Anklet', /\banklet\b/i], ['Ring', /\bring\b/i],
    ['Wedding band', /\bwedding\s+band\b/i], ['Bracelet', /\bbracelet\b/i],
    ['Bangle', /\bbangle\b/i], ['Chain', /\b(?:gold\s+)?chain\b/i],
  ],
  ACCESSORY: [
    ['Wallet', /\bwallet\b/i], ['Card holder', /\bcard\s+holder\b/i], ['Belt', /\bbelt\b/i],
    ['Sunglasses', /\bsunglasses\b/i], ['Cufflinks', /\bcufflinks?\b/i],
    ['Fountain pen', /\bfountain\s+pen\b/i], ['Lighter', /\blighter\b/i],
    ['Scarf', /\bscar(?:f|ves)\b/i], ['Silk tie', /\bsilk\s+tie\b/i],
    ['Key holder', /\bkey\s+holder\b/i],
  ],
};

function clean(value) {
  const result = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  return result || null;
}

function sourceText(source = {}) {
  const raw = source.raw_data || {};
  return [raw.brand, raw.maker, raw.title, raw.model, raw.description, raw.comments, source.raw_message]
    .map(clean).filter(Boolean).join('\n');
}

function inferLuxuryBrand(source = {}) {
  const raw = source.raw_data || {};
  const supplied = clean(raw.brand || raw.maker);
  if (supplied) return supplied;
  const text = sourceText(source);
  return LUXURY_BRANDS.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function inferLuxuryItemType(source = {}, category) {
  const text = sourceText(source);
  return (TYPE_PATTERNS[String(category || '').toUpperCase()] || [])
    .find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function inferLuxuryCondition(source = {}) {
  const text = sourceText(source);
  if (/\b(?:brand\s+new|new\s+in\s+box|bnib|unworn)\b/i.test(text)) return 'New';
  if (/\b(?:like\s+new|lnib|mint)\b/i.test(text)) return 'Used - Like New';
  if (/\b(?:excellent|very\s+good)\b/i.test(text)) return 'Used - Good';
  if (/\b(?:fair|worn|visible\s+wear)\b/i.test(text)) return 'Used - Fair';
  if (/\b(?:pre[- ]?owned|used)\b/i.test(text)) return 'Used';
  return null;
}

function normalizeLuxuryIdentity(source = {}, category) {
  const raw = source.raw_data || {};
  const itemType = inferLuxuryItemType(source, category);
  const suppliedTitle = clean(raw.model || raw.title);
  return {
    brand: inferLuxuryBrand(source),
    model: suppliedTitle || itemType,
    reference: clean(raw.reference || raw.normalized_reference || raw.sku || raw.style_number),
    condition: inferLuxuryCondition(source),
    luxury_item_name: suppliedTitle || itemType,
    luxury_item_type: itemType,
  };
}

module.exports = {
  LUXURY_BRANDS,
  TYPE_PATTERNS,
  inferLuxuryBrand,
  inferLuxuryCondition,
  inferLuxuryItemType,
  normalizeLuxuryIdentity,
  sourceText,
};
