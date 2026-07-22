'use strict';

function percentile(sorted, probability) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarizePrices(values) {
  const raw = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  const sortedRaw = [...raw].sort((a, b) => a - b);
  const sample_quality = raw.length < 5 ? 'observational' : raw.length < 10 ? 'provisional' : 'robust';

  if (!raw.length) {
    return { sample_quality, analytics_ready: false, raw_count: 0, included: [], outliers: [], stats: null };
  }

  const q1 = percentile(sortedRaw, 0.25);
  const q3 = percentile(sortedRaw, 0.75);
  const iqr = q3 - q1;
  const lower_fence = raw.length >= 5 ? q1 - 1.5 * iqr : null;
  const upper_fence = raw.length >= 5 ? q3 + 1.5 * iqr : null;
  const included = lower_fence == null
    ? raw
    : raw.filter(value => value >= lower_fence && value <= upper_fence);
  const outliers = lower_fence == null
    ? []
    : raw.filter(value => value < lower_fence || value > upper_fence);
  const sorted = [...included].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;

  return {
    sample_quality,
    analytics_ready: raw.length >= 5,
    raw_count: raw.length,
    included,
    outliers,
    stats: {
      avg: Math.round(avg),
      median: Math.round(percentile(sorted, 0.5)),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      range: sorted[sorted.length - 1] - sorted[0],
      q1: Math.round(q1),
      q3: Math.round(q3),
      iqr: Math.round(iqr),
      lower_fence: lower_fence == null ? null : Math.round(lower_fence),
      upper_fence: upper_fence == null ? null : Math.round(upper_fence),
    },
  };
}

function classifyPrice(value, stats, options = {}) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return { included: false, reason: 'INVALID_PRICE' };
  const minimumPrice = Number(options.minimumPrice || 0);
  if (minimumPrice > 0 && price < minimumPrice) {
    return { included: false, reason: 'BELOW_MARKET_PLAUSIBILITY_FLOOR' };
  }
  if (!stats || stats.lower_fence == null || stats.upper_fence == null) {
    return { included: true, reason: null };
  }
  if (price < stats.lower_fence) return { included: false, reason: 'BELOW_IQR_FENCE' };
  if (price > stats.upper_fence) return { included: false, reason: 'ABOVE_IQR_FENCE' };
  return { included: true, reason: null };
}

function normalizeDimension(value, fallback = null, keepUnknown = false) {
  const clean = String(value || '').trim();
  const normalized = clean.toLowerCase().trim();
  if (!normalized) return fallback;
  if (['unspecified', 'unknown', 'unknow', 'n/a', 'na', '-'].includes(normalized)) {
    return keepUnknown ? clean : fallback;
  }
  return clean;
}

function normalizeComparableCondition(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'new') return 'New';
  if (normalized === 'used') return 'Used';
  return 'Unspecified';
}

function buildDialFilters(rows) {
  const groups = new Map();
  for (const row of rows) {
    const dial = normalizeDimension(row.dial_color);
    if (!dial) continue;
    const key = dial.toLowerCase();
    const current = groups.get(key) || { dial_color: dial, count: 0 };
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.dial_color.localeCompare(b.dial_color));
}

function selectComparableRows(rows, options = {}) {
  const requestedDial = String(options.dial || '').trim().toLowerCase();
  const requestedCondition = normalizeComparableCondition(options.condition);
  const hasConditionFilter = ['new', 'used', 'unspecified'].includes(String(options.condition || '').trim().toLowerCase());
  return rows.filter(row => {
    const dial = normalizeDimension(row.dial_color);
    if (!dial) return false;
    if (requestedDial && dial.toLowerCase() !== requestedDial) return false;
    return !hasConditionFilter || normalizeComparableCondition(row.condition) === requestedCondition;
  });
}

function buildComparableCohorts(rows, options = {}) {
  const { includeUnknown = false } = options;
  const groups = new Map();
  for (const row of rows) {
    const condition = normalizeDimension(row.condition, null, includeUnknown);
    const dial_color = normalizeDimension(row.dial_color, null, includeUnknown);
    if (condition == null || dial_color == null) continue;
    const key = `${condition.toLowerCase()}::${dial_color.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { key, condition, dial_color, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()]
    .map(group => ({ ...group, count: group.rows.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

module.exports = {
  buildComparableCohorts,
  buildDialFilters,
  classifyPrice,
  normalizeComparableCondition,
  percentile,
  selectComparableRows,
  summarizePrices,
};

