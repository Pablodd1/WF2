/**
 * CANONICAL CATALOG TAXONOMY ROLLUP ENGINE
 * 
 * Normalizes model names and resolves fragmented sub-collections, complication types,
 * and edition nicknames into canonical parent collection hierarchies.
 */

const PATEK_COLLECTION_ROLLUPS = [
  // Nautilus Rollups
  { pattern: /^nautilus\b/i, canonical: 'Nautilus' },
  
  // Aquanaut Rollups
  { pattern: /^aquanaut\b/i, canonical: 'Aquanaut' },

  // Cubitus Rollups
  { pattern: /^cubitus\b/i, canonical: 'Cubitus' },

  // Gondolo Rollups
  { pattern: /^gondolo\b/i, canonical: 'Gondolo' },

  // Twenty~4 Rollups
  { pattern: /^twenty[~\-\s]?4\b/i, canonical: 'Twenty~4' },

  // Calatrava Rollups
  { pattern: /^calatrava\b/i, canonical: 'Calatrava' },

  // Ellipse Rollups
  { pattern: /^(golden\s+)?ellipse\b/i, canonical: 'Golden Ellipse' },

  // Complications & Grand Complications Rollups (Grand Complications first)
  {
    pattern: /^(grand\s+complication|perpetual\s+calendar|tourbillon|minute\s+repeater\s+perpetual)/i,
    canonical: 'Grand Complications'
  },
  {
    pattern: /^(annual\s+calendar|chronograph|minute\s+repeater|split[ \-]?seconds|world\s+time|travel\s+time|flyback|regulator|celestial|astronomy|alarm)/i,
    canonical: 'Complications'
  }
];

const GENERAL_MODEL_ROLLUPS = {
  'Audemars Piguet': [
    { pattern: /^royal\s+oak\s+offshore\b/i, canonical: 'Royal Oak Offshore' },
    { pattern: /^royal\s+oak\s+concept\b/i, canonical: 'Royal Oak Concept' },
    { pattern: /^royal\s+oak\b/i, canonical: 'Royal Oak' },
    { pattern: /^code\s*11\.?59\b/i, canonical: 'Code 11.59' }
  ],
  'Rolex': [
    { pattern: /^daytona\b/i, canonical: 'Daytona' },
    { pattern: /^submariner\b/i, canonical: 'Submariner' },
    { pattern: /^datejust\b/i, canonical: 'Datejust' },
    { pattern: /^day[ \-]?date\b/i, canonical: 'Day-Date' },
    { pattern: /^gmt[ \-]?master\b/i, canonical: 'GMT-Master II' },
    { pattern: /^sea[ \-]?dweller\b/i, canonical: 'Sea-Dweller' },
    { pattern: /^yacht[ \-]?master\b/i, canonical: 'Yacht-Master' },
    { pattern: /^explorer\b/i, canonical: 'Explorer' },
    { pattern: /^sky[ \-]?dweller\b/i, canonical: 'Sky-Dweller' },
    { pattern: /^oyster\s+perpetual\b/i, canonical: 'Oyster Perpetual' }
  ]
};

/**
 * Normalizes a raw model string into its canonical parent collection.
 * 
 * @param {string} rawModel 
 * @param {string} brand 
 * @returns {string} canonical model name
 */
function normalizeCanonicalModel(rawModel, brand = '') {
  const model = String(rawModel || '').trim();
  if (!model || model === 'Reference-only listings') return model;

  const brandNormalized = String(brand || '').trim().toLowerCase();

  // Patek Philippe Normalization Rules
  if (brandNormalized.includes('patek')) {
    for (const rule of PATEK_COLLECTION_ROLLUPS) {
      if (rule.pattern.test(model)) {
        return rule.canonical;
      }
    }
  }

  // General Brand Normalization Rules
  for (const [brandKey, rules] of Object.entries(GENERAL_MODEL_ROLLUPS)) {
    if (brandNormalized.includes(brandKey.toLowerCase())) {
      for (const rule of rules) {
        if (rule.pattern.test(model)) {
          return rule.canonical;
        }
      }
    }
  }

  return model;
}

module.exports = {
  normalizeCanonicalModel,
  PATEK_COLLECTION_ROLLUPS,
  GENERAL_MODEL_ROLLUPS
};
