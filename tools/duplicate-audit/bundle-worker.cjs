'use strict';

const { parentPort } = require('node:worker_threads');
const { auditCandidates, likelyBundle } = require('./bundle-candidates.cjs');

parentPort.on('message', ({ taskId, rows }) => {
  try {
    const results = rows.map(row => ({
      sourceId: row.id,
      bundleRisk: likelyBundle(row.raw_message),
      candidateRows: auditCandidates(row),
    }));
    parentPort.postMessage({ taskId, results });
  } catch (error) {
    parentPort.postMessage({ taskId, error: error.message });
  }
});
