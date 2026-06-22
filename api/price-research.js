/**
 * PRICE RESEARCH API — /api/price-research
 * 
 * Returns per-reference market analytics.
 * Currently uses mock data for demo purposes.
 * In production, wire to thecollective_inventory DB.
 */

const MOCK_DATA = {
  '52506': {
    brand: 'Rolex', model: '1908', primaryDial: 'Ice Blue',
    dialColors: ['Ice Blue', 'Silver', 'Blue', 'White', 'Brown'],
    liquidity: { fsCount: 94 },
    pricing: {
      current: { min: 38365, avg: 41500, max: 45408, count: 50 },
      drift: -21.98,
      min: 38365, avg: 41500, max: 45408,
    },
    chart: [
      { month: '2025-06', min: 38900, avg: 44500, max: 58745, count: 8 },
      { month: '2025-07', min: 41500, avg: 48730, max: 55950, count: 12 },
      { month: '2025-08', min: 40179, avg: 45150, max: 53189, count: 14 },
      { month: '2025-09', min: 38365, avg: 43280, max: 49745, count: 11 },
      { month: '2025-10', min: 39100, avg: 42800, max: 52000, count: 16 },
      { month: '2025-11', min: 38776, avg: 41500, max: 45500, count: 12 },
    ],
    listings: [
      { title: '52506 ice blue Brand N3W, 10/2025 Watch and card 48,000 HKD', price: 48000, currency: 'HKD', priceUSD: 6122, dial: 'Ice Blue', date: '2025-10-14', region: 'Asia', phone: '97455277753' },
      { title: '52506 ice blue Brand N3W, 10/2025 Watch and card 48,000 Watch in US', price: 48000, currency: 'HKD', priceUSD: 6122, dial: 'Ice Blue', date: '2025-10-16', region: 'Asia', phone: '85261311311' },
      { title: 'HongKong Ready Rolex 52506 Ice Blue Brandnew 11/2025 303,000HKD', price: 303000, currency: 'HKD', priceUSD: 38648, dial: 'Ice Blue', date: '2025-12-15', region: 'Asia', phone: '84395825203' },
      { title: '52506 ice blue 11/2025 *$304000*', price: 304000, currency: 'HKD', priceUSD: 38776, dial: 'Ice Blue', date: '2025-11-09', region: 'Asia', phone: '85266626263' },
      { title: 'Rolex 52506 new 11/25 305,000hkd Cheap 🔥🔥', price: 305000, currency: 'HKD', priceUSD: 38903, dial: 'Ice Blue', date: '2025-12-12', region: 'Asia', phone: '85254203746' },
      { title: 'HongKong Ready Rolex 52506 Ice Blue Brandnew 11/2025 305,000HKD', price: 305000, currency: 'HKD', priceUSD: 38903, dial: 'Ice Blue', date: '2025-12-12', region: 'Asia', phone: '84395825203' },
      { title: 'New 52506 Ice Blue N4/2025 HKD 308000', price: 308000, currency: 'HKD', priceUSD: 39286, dial: 'Ice Blue', date: '2025-11-16', region: 'Asia', phone: '85255048431' },
      { title: '*NEW 52506 ice blue n4, $309k HKD', price: 309000, currency: 'HKD', priceUSD: 39413, dial: 'Ice Blue', date: '2025-11-17', region: 'Asia', phone: '85260161840' },
      { title: 'Rolex 52506 Ice Blue Brandnew 11/2025 315,000HKD', price: 315000, currency: 'HKD', priceUSD: 40179, dial: 'Ice Blue', date: '2025-12-03', region: 'Asia', phone: '84395825203' },
      { title: 'HongKong Ready Rolex 52506 Ice Blue Brandnew 11/2025 315,000HKD', price: 315000, currency: 'HKD', priceUSD: 40179, dial: 'Ice Blue', date: '2025-12-04', region: 'Asia', phone: '84395825203' },
      { title: '52506 ice Blue N11/2025 // 318.000 HKD', price: 318000, currency: 'HKD', priceUSD: 40561, dial: 'Ice Blue', date: '2025-11-26', region: 'Asia', phone: '84333399899' },
      { title: '🆕52506 ice blue N5/25 hkd313k usd40.6k Hong Kong ready!!!', price: 313000, currency: 'HKD', priceUSD: 40600, dial: 'Ice Blue', date: '2025-12-07', region: 'Asia', phone: '85266923352' },
      { title: '52506 ice blue/brown 11/2025 New 320k hkd', price: 320000, currency: 'HKD', priceUSD: 40816, dial: 'Ice Blue', date: '2025-12-19', region: 'Asia', phone: '85254305292' },
      { title: 'Unworn 52506 May 25 watch & card $42,500 + ship', price: 42500, currency: 'USD', priceUSD: 42500, dial: 'Ice Blue', date: '2025-12-12', region: 'North America', phone: '13055286236' },
      { title: '52506 Ice Blue Brown Strap 2025-N10 Both Tags 🏷️ HKD 335,000 📮HK Ready Stock', price: 335000, currency: 'HKD', priceUSD: 42730, dial: 'Ice Blue', date: '2025-10-31', region: 'Asia', phone: '85251656225' },
      { title: '52506 bnib $44,500', price: 44500, currency: 'USD', priceUSD: 44500, dial: 'Ice Blue', date: '2025-12-08', region: 'North America', phone: '15617798048' },
      { title: 'New 52506 Ice Blue N4/2025 HKD 356000', price: 356000, currency: 'HKD', priceUSD: 45408, dial: 'Ice Blue', date: '2025-11-10', region: 'Asia', phone: '85296652994' },
      { title: 'Brand: Rolex Model: N3W! FRESH! 1908 ice blue dial platinum brown strap Ref: 52506 Date: 2025 $52,000', price: 52000, currency: 'USD', priceUSD: 52000, dial: 'Ice Blue', date: '2025-10-16', region: 'North America', phone: '19294855777' },
      { title: '52506. N6. $417000. 3-5day in hk.', price: 417000, currency: 'HKD', priceUSD: 53189, dial: 'Ice Blue', date: '2025-08-04', region: 'Asia', phone: '85290849384' },
      { title: '215,000 AED 58,745 USD 52506 PLATINUM Brand new 2025', price: 215000, currency: 'AED', priceUSD: 58745, dial: 'Ice Blue', date: '2025-06-27', region: 'Asia', phone: '971543743717' },
    ],
    totalListings: 50, outliers: 2, duplicates: 3,
  },
  '126334': {
    brand: 'Rolex', model: 'Datejust 41', primaryDial: 'Blue',
    dialColors: ['Blue', 'Grey', 'Green', 'Black', 'White', 'Silver'],
    liquidity: { fsCount: 4855 },
    pricing: {
      current: { min: 8300, avg: 11200, max: 15800, count: 312 },
      drift: -8.5,
      min: 8300, avg: 11200, max: 15800,
    },
    chart: [
      { month: '2025-06', min: 9200, avg: 12300, max: 16800, count: 52 },
      { month: '2025-07', min: 8800, avg: 11800, max: 15900, count: 48 },
      { month: '2025-08', min: 8500, avg: 11500, max: 15500, count: 55 },
      { month: '2025-09', min: 8300, avg: 11300, max: 15800, count: 50 },
      { month: '2025-10', min: 8400, avg: 11200, max: 15200, count: 53 },
      { month: '2025-11', min: 8600, avg: 11100, max: 14900, count: 54 },
    ],
    listings: [
      { title: '126334 Blue jub 2024Used Full link 95500k', price: 95500, currency: 'HKD', priceUSD: 12244, dial: 'Blue', date: '2025-11-15', region: 'Asia' },
      { title: '126334 Blue rom jub 2024Used No box 93000k', price: 93000, currency: 'HKD', priceUSD: 11923, dial: 'Blue', date: '2025-11-20', region: 'Asia' },
      { title: 'Datejust 41 126334 Blue Dial 2024 $12,500', price: 12500, currency: 'USD', priceUSD: 12500, dial: 'Blue', date: '2025-12-01', region: 'North America' },
    ],
    totalListings: 312, outliers: 8, duplicates: 15,
  },
  '5711/1A': {
    brand: 'Patek Philippe', model: 'Nautilus', primaryDial: 'Blue',
    dialColors: ['Blue', 'White', 'Grey'],
    liquidity: { fsCount: 1247 },
    pricing: {
      current: { min: 95000, avg: 145000, max: 220000, count: 89 },
      drift: +12.3,
      min: 95000, avg: 145000, max: 220000,
    },
    chart: [
      { month: '2025-06', min: 88000, avg: 129000, max: 195000, count: 15 },
      { month: '2025-07', min: 91000, avg: 135000, max: 205000, count: 14 },
      { month: '2025-08', min: 93000, avg: 140000, max: 210000, count: 16 },
      { month: '2025-09', min: 94000, avg: 142000, max: 215000, count: 15 },
      { month: '2025-10', min: 95000, avg: 144000, max: 218000, count: 14 },
      { month: '2025-11', min: 95000, avg: 145000, max: 220000, count: 15 },
    ],
    listings: [
      { title: '5711/1A Blue 2024 1.8M HKD', price: 1800000, currency: 'HKD', priceUSD: 230769, dial: 'Blue', date: '2025-11-01', region: 'Asia' },
      { title: 'Patek 5711/1A Blue full set 2023 $185,000', price: 185000, currency: 'USD', priceUSD: 185000, dial: 'Blue', date: '2025-10-15', region: 'North America' },
    ],
    totalListings: 89, outliers: 3, duplicates: 12,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const reference = url.searchParams.get('reference');
  if (!reference) return res.status(400).json({ error: 'reference required' });

  const data = MOCK_DATA[reference];
  if (!data) {
    return res.status(200).json({ 
      success: false, 
      reference,
      error: 'No data for this reference. Try: 52506, 126334, 5711/1A' 
    });
  }

  return res.status(200).json({ success: true, reference, ...data });
}
