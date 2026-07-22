'use strict';

function nextMonth(month) {
  const [year, value] = String(month).split('-').map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildThreeMonthForecast(monthly, options = {}) {
  if (!options.enabled) {
    return { available: false, reason: 'Select a specific condition to view the three-month forecast.', points: [] };
  }
  const history = (monthly || []).filter(point => Number.isFinite(Number(point.avg_price)));
  if (history.length < 3 || Number(options.observationCount || 0) < 5) {
    return { available: false, reason: 'At least three monthly points and five comparable listings are required for a forecast.', points: [] };
  }

  const points = history.slice(-6);
  const n = points.length;
  const sumX = points.reduce((sum, _point, index) => sum + index, 0);
  const sumY = points.reduce((sum, point) => sum + Number(point.avg_price), 0);
  const sumXY = points.reduce((sum, point, index) => sum + index * Number(point.avg_price), 0);
  const sumXX = points.reduce((sum, _point, index) => sum + index * index, 0);
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator ? (n * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / n;
  const meanLowerSpread = points.reduce((sum, point) => sum + Math.max(0, Number(point.avg_price) - Number(point.min_price)), 0) / n;
  const meanUpperSpread = points.reduce((sum, point) => sum + Math.max(0, Number(point.max_price) - Number(point.avg_price)), 0) / n;

  let month = points[points.length - 1].month;
  const forecast = Array.from({ length: 3 }, (_value, index) => {
    month = nextMonth(month);
    const avg = Math.max(0, Math.round(intercept + slope * (n + index)));
    return {
      month,
      avg_price: avg,
      min_price: Math.max(0, Math.round(avg - meanLowerSpread)),
      max_price: Math.round(avg + meanUpperSpread),
      projected: true,
    };
  });

  return {
    available: true,
    reason: null,
    method: 'six-month linear trend with historical average range',
    points: forecast,
  };
}

module.exports = { buildThreeMonthForecast };
