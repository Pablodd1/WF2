'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  compareCursor,
  discoverInputFiles,
  isTransientStatus,
  prepareOutput,
  rpc,
  run,
  submitBatch,
} = require('../tools/mariadb-live/import-raw.cjs');
const { sourceRecord } = require('../tools/mariadb-live/lib.cjs');

function record(id, createdOn, title = `Rolex ${id} USD 10000`) {
  return sourceRecord({ id, created_on: createdOn, title }, '2026-08-10T12:00:00.000Z');
}

test('raw import retries transient transport and server failures only', async () => {
  assert.equal(isTransientStatus(408), true);
  assert.equal(isTransientStatus(429), true);
  assert.equal(isTransientStatus(503), true);
  assert.equal(isTransientStatus(400), false);

  const calls = [];
  const fetchImpl = async () => {
    calls.push(calls.length + 1);
    if (calls.length === 1) throw new TypeError('fetch failed');
    if (calls.length === 2) return { ok: false, status: 503, text: async () => 'temporary' };
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  const result = await rpc(
    { baseUrl: 'https://example.supabase.co', key: 'masked' },
    'ingest_mariadb_raw_batch',
    {},
    fetchImpl,
    { maxAttempts: 4, baseDelayMs: 0, sleep: async () => {} },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 3);
});

test('raw import fails deterministic client errors without retrying', async () => {
  let calls = 0;
  await assert.rejects(
    rpc(
      { baseUrl: 'https://example.supabase.co', key: 'masked' },
      'ingest_mariadb_raw_batch',
      {},
      async () => {
        calls += 1;
        return { ok: false, status: 400, text: async () => 'invalid batch' };
      },
      { maxAttempts: 4, baseDelayMs: 0, sleep: async () => {} },
    ),
    /failed \(400\): invalid batch/,
  );
  assert.equal(calls, 1);
});

test('raw import rejects non-increasing keyset input', () => {
  assert.deepEqual(
    compareCursor({ last_created_on: '2026-08-01 00:00:00', last_source_id: 'a' }, record('b', '2026-08-01 00:00:00')),
    { createdOn: '2026-08-01 00:00:00', sourceId: 'b' },
  );
  assert.throws(
    () => compareCursor({ last_created_on: '2026-08-01 00:00:00', last_source_id: 'b' }, record('a', '2026-08-01 00:00:00')),
    /not strictly increasing/,
  );
});

test('raw import discovers deterministic JSONL inputs and binds checkpoint to them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-raw-input-'));
  try {
    fs.mkdirSync(path.join(root, 'raw'));
    fs.writeFileSync(path.join(root, 'raw', '002.jsonl'), '{}\n');
    fs.writeFileSync(path.join(root, 'raw', '001.jsonl'), '{}\n');
    const files = discoverInputFiles(root);
    assert.deepEqual(files.map(file => path.basename(file)), ['001.jsonl', '002.jsonl']);
    const output = path.join(root, 'output');
    const prepared = prepareOutput({ output, runKey: 'canary' }, files);
    assert.equal(prepared.checkpoint.file_index, 0);
    assert.equal(prepared.checkpoint.input_rows, 0);
    assert.equal(fs.existsSync(prepared.paths.checkpoint), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('submitted raw batch reconciles inserted and existing immutable versions', async () => {
  const records = [record('a', '2026-08-01 00:00:00'), record('b', '2026-08-01 00:00:01')];
  let request;
  const result = await submitBatch({ baseUrl: 'https://example.test', key: 'secret', runKey: 'canary' }, {
    batch_sequence: 0,
    last_created_on: '1970-01-01 00:00:00',
    last_source_id: '',
  }, records, async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        input_rows: 2,
        envelope_rows_inserted: 1,
        version_rows_inserted: 1,
        version_rows_existing: 1,
        error_rows: 0,
        last_created_on: '2026-08-01 00:00:01',
        last_source_id: 'b',
      }),
    };
  });
  assert.equal(result.input_rows, 2);
  assert.match(request.url, /ingest_mariadb_raw_batch$/);
  assert.equal(request.options.headers.apikey, 'secret');
  assert.equal(JSON.parse(request.options.body).p_records.length, 2);
});

test('raw import streams a canary, checkpoints after RPC, and completes with zero publication writes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-raw-run-'));
  try {
    const input = path.join(root, 'raw-records.jsonl');
    fs.writeFileSync(input, [
      record('a', '2026-08-01 00:00:00'),
      record('b', '2026-08-01 00:00:01'),
      record('c', '2026-08-01 00:00:02'),
    ].map(value => `${JSON.stringify(value)}\n`).join(''));
    const output = path.join(root, 'output');
    const calls = [];
    const report = await run({
      config: {
        baseUrl: 'https://example.test', key: 'secret', input, runKey: 'canary', batchSize: 2, output,
      },
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ url, body });
        if (url.endsWith('/complete_mariadb_raw_import')) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'RAW_COPY_COMPLETE' }) };
        }
        const rows = body.p_records;
        const last = rows.at(-1);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            input_rows: rows.length,
            envelope_rows_inserted: rows.length,
            version_rows_inserted: rows.length,
            version_rows_existing: 0,
            error_rows: 0,
            last_created_on: last.source_created_on,
            last_source_id: last.source_id,
          }),
        };
      },
    });
    assert.equal(calls.filter(call => call.url.endsWith('/ingest_mariadb_raw_batch')).length, 2);
    assert.equal(report.input_rows, 3);
    assert.equal(report.reconciled, true);
    assert.equal(report.watch_records_writes, 0);
    assert.equal(report.normalization_writes, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'checkpoint.json'), 'utf8')).complete, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('forward migration is copy-first and denies customer roles', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260810100000_immutable_mariadb_raw_import.sql'),
    'utf8',
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.raw_message_versions/);
  assert.match(sql, /CONSTRAINT raw_message_versions_identity UNIQUE \(raw_message_id, source_hash\)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.ingest_mariadb_raw_batch/);
  assert.match(sql, /watch_records_writes', 0/);
  assert.match(sql, /normalization_writes', 0/);
  assert.match(sql, /REVOKE ALL ON public\.raw_message_versions FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.watch_records/i);
});

test('forward completion migration repairs the exact RPC signature atomically', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260810103000_complete_immutable_mariadb_raw_import.sql',
    ),
    'utf8',
  );
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.ingest_mariadb_raw_batch\(\s*TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB\s*\)/,
  );
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.complete_mariadb_raw_import/);
  assert.match(sql, /watch_records_writes', 0/);
  assert.match(sql, /normalization_writes', 0/);
  assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.watch_records/i);
});

test('self-contained forward migration creates only the raw import contract', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260810104500_self_contained_immutable_mariadb_raw_import.sql',
    ),
    'utf8',
  );
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.raw_messages/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.raw_message_versions/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.ingest_mariadb_raw_batch/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.complete_mariadb_raw_import/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.ingest_mariadb_raw_batch\(\s*TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB\s*\)/,
  );
  assert.match(sql, /REVOKE ALL ON public\.raw_messages FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS public\.listing_prices/);
  assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.watch_records/i);
});

test('raw envelope compaction preserves a proven immutable full version', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260810110000_compact_mariadb_raw_envelopes.sql',
    ),
    'utf8',
  );
  assert.match(sql, /CREATE TRIGGER trg_compact_mariadb_raw_envelope/);
  assert.match(sql, /version\.raw_payload = envelope\.raw_payload/);
  assert.match(sql, /RAISE EXCEPTION 'refusing to compact/);
  assert.match(sql, /envelope\.source_platform = 'mariadb'/);
  assert.match(sql, /envelope\.raw_payload \? 'raw_data'/);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
  assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.watch_records/i);
});
