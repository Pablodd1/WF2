'use strict';

function redactPublicSource(value) {
  return String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
    .replace(/(https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/)[^\s)]+/gi, '$1[REDACTED]')
    .replace(/\b(phone|mobile|whatsapp|contact|tel)\s*[:=-]?\s*\+?[\d().\s-]{8,22}/gi, '$1: [REDACTED]')
    .replace(/(^|[^\w$])\+\d(?:[\s().-]*\d){7,14}\b/g, '$1[PHONE REDACTED]')
    .replace(/(^|\n)(\s*\[[^\]]+\]\s*)?\+\d[\d\s()-]{7,20}(?=\s*:)/g, '$1$2[DEALER REDACTED]');
}

module.exports = { redactPublicSource };

