/** CATALOG BRANDS — /api/catalog-brands */
const { listCatalogBrands } = require('./_lib/catalog');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const brands = listCatalogBrands();
    return res.status(200).json({
      success: true,
      brand_count: brands.length,
      model_count: brands.reduce((sum, item) => sum + item.model_count, 0),
      reference_count: brands.reduce((sum, item) => sum + item.reference_count, 0),
      brands,
    });
  } catch (error) {
    console.error('[catalog-brands] error:', error.message);
    return res.status(500).json({ error: 'Failed to load catalog brands' });
  }
};
