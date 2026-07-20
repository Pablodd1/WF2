'use strict';

function encodeTradingCursor(row) {
  if (!row?.id) return null;
  return Buffer.from(JSON.stringify({
    createdAt: row.created_at || null,
    id: String(row.id),
  })).toString('base64url');
}

function decodeTradingCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    const id = String(parsed?.id || '');
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(id)) return null;
    if (parsed.createdAt == null) return { createdAt: null, id };
    const date = new Date(parsed.createdAt);
    if (Number.isNaN(date.getTime())) return null;
    return { createdAt: date.toISOString(), id };
  } catch {
    return null;
  }
}

function tradingCursorFilter(cursor) {
  if (!cursor) return null;
  if (!cursor.createdAt) {
    return `or(and(created_at.is.null,id.lt.${cursor.id}),created_at.not.is.null)`;
  }
  return `or(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`;
}

module.exports = { decodeTradingCursor, encodeTradingCursor, tradingCursorFilter };
