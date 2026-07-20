'use strict';

function redactPublicSource(value) {
  return String(value || '')
    .replace(/(https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/)[^\s)]+/gi, '$1[REDACTED]')
    .replace(/\b(phone|mobile|whatsapp|contact|tel)\s*[:=-]?\s*\+?[\d().\s-]{8,22}/gi, '$1: [REDACTED]')
    .replace(/(^|\n)(\s*\[[^\]]+\]\s*)?\+\d[\d\s()-]{7,20}(?=\s*:)/g, '$1$2[DEALER REDACTED]');
}

module.exports = { redactPublicSource };

