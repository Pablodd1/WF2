'use strict';

function redactPublicSource(value) {
  return String(value || '');
}

module.exports = { redactPublicSource };

