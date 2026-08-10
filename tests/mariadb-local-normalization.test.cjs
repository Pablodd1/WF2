'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readExistingProgress, run } = require('../tools/mariadb-live/normalize-local.cjs');
const { jsonLine, sourceRecord } = require('../tools/mariadb-live/lib.cjs');

function source(id) {
  return sourceRecord({
    id,
    created_on: `2026-08-10 10:00:0${id}`,
    title: `WTS Rolex 116500LN white USD ${25000 + Number(id)}`,
  }, '2026-08-10T15:00:00.000Z');
}

test('local normalization resumes from durable evidence lines and buffers output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-normalize-resume-'));
  const input = path.join(root, 'raw.jsonl');
  const output = path.join(root, 'output');
  try {
    fs.writeFileSync(input, `${jsonLine(source('1'))}${jsonLine(source('2'))}`);
    await run({ env: {
      MARIADB_NORMALIZE_INPUT: input,
      MARIADB_NORMALIZE_OUTPUT: output,
      MARIADB_NORMALIZE_MAX_ROWS: '1',
      MARIADB_NORMALIZE_FLUSH_ROWS: '10',
    } });
    for (const name of ['coverage-report.json', 'blockers-by-reason.csv', 'normalization-reconciliation.json']) {
      fs.rmSync(path.join(output, name));
    }
    await run({ env: {
      MARIADB_NORMALIZE_INPUT: input,
      MARIADB_NORMALIZE_OUTPUT: output,
      MARIADB_NORMALIZE_MAX_ROWS: '2',
      MARIADB_NORMALIZE_FLUSH_ROWS: '10',
      MARIADB_NORMALIZE_RESUME: '1',
    } });
    const paths = {
      proposals: path.join(output, 'normalization-proposals.jsonl'),
      errors: path.join(output, 'normalization-errors.csv'),
    };
    const progress = await readExistingProgress(paths);
    const report = JSON.parse(fs.readFileSync(path.join(output, 'normalization-reconciliation.json'), 'utf8'));
    assert.equal(progress.inputRows, 2);
    assert.equal(progress.outputRows, 2);
    assert.equal(progress.errorRows, 0);
    assert.equal(report.input_rows, 2);
    assert.equal(report.reconciled, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
