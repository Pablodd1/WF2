'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const zlib = require('node:zlib');
const { CONTRACT, atomicJson, boundedInteger, stableJson } = require('./lib.cjs');

const IMPORT_CONTRACT = 'wf-mariadb-raw-import-v1';

function config(env = process.env) {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MARIADB_RAW_IMPORT_INPUT'];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  return {
    baseUrl: String(env.SUPABASE_URL).replace(/\/$/, ''),
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    input: path.resolve(env.MARIADB_RAW_IMPORT_INPUT),
    runKey: env.MARIADB_RAW_IMPORT_RUN_KEY || `mariadb-raw-${new Date().toISOString().slice(0, 10)}`,
    batchSize: boundedInteger(env.MARIADB_RAW_IMPORT_BATCH_SIZE, 200, 10, 500, 'MARIADB_RAW_IMPORT_BATCH_SIZE'),
    output: path.resolve(env.MARIADB_RAW_IMPORT_OUTPUT || 'audit-output/mariadb-live/raw-import'),
  };
}

function discoverInputFiles(input) {
  if (!fs.existsSync(input)) throw new Error(`Raw import input does not exist: ${input}`);
  const stat = fs.statSync(input);
  if (stat.isFile()) return [input];
  const rawDirectory = path.join(input, 'raw');
  const candidates = fs.existsSync(rawDirectory)
    ? fs.readdirSync(rawDirectory).map(name => path.join(rawDirectory, name))
    : fs.readdirSync(input).map(name => path.join(input, name));
  const files = candidates
    .filter(file => fs.statSync(file).isFile() && /(?:\.jsonl|\.jsonl\.gz)$/i.test(file))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  if (!files.length) throw new Error(`No JSONL raw-evidence files were found under: ${input}`);
  return files;
}

function inputFingerprint(files) {
  return crypto.createHash('sha256')
    .update(stableJson(files.map(file => ({
      path: path.resolve(file),
      size: fs.statSync(file).size,
      mtime_ms: fs.statSync(file).mtimeMs,
    }))))
    .digest('hex');
}

function prepareOutput(runConfig, files) {
  fs.mkdirSync(runConfig.output, { recursive: true });
  const paths = {
    checkpoint: path.join(runConfig.output, 'checkpoint.json'),
    reconciliation: path.join(runConfig.output, 'reconciliation.json'),
  };
  const fingerprint = inputFingerprint(files);
  let checkpoint = {
    contract: IMPORT_CONTRACT,
    source_contract: CONTRACT,
    input_fingerprint: fingerprint,
    run_key: runConfig.runKey,
    file_index: 0,
    line_index: 0,
    batch_sequence: 0,
    input_rows: 0,
    envelope_rows_inserted: 0,
    version_rows_inserted: 0,
    version_rows_existing: 0,
    error_rows: 0,
    last_created_on: '1970-01-01 00:00:00',
    last_source_id: '',
    complete: false,
    started_at: new Date().toISOString(),
  };
  if (fs.existsSync(paths.checkpoint)) {
    checkpoint = JSON.parse(fs.readFileSync(paths.checkpoint, 'utf8'));
    if (checkpoint.contract !== IMPORT_CONTRACT
      || checkpoint.source_contract !== CONTRACT
      || checkpoint.input_fingerprint !== fingerprint
      || checkpoint.run_key !== runConfig.runKey) {
      throw new Error('Raw-import checkpoint does not match this immutable input/run configuration');
    }
    if (checkpoint.complete) throw new Error('Raw-import checkpoint is already complete');
  } else {
    atomicJson(paths.checkpoint, checkpoint);
  }
  return { paths, checkpoint };
}

function openLines(file) {
  const source = fs.createReadStream(file);
  const input = file.toLowerCase().endsWith('.gz') ? source.pipe(zlib.createGunzip()) : source;
  return readline.createInterface({ input, crlfDelay: Infinity });
}

function compareCursor(previous, record) {
  const createdOn = String(record.source_created_on || '');
  const sourceId = String(record.source_id || '');
  if (!createdOn || !sourceId) throw new Error('Every raw record needs source_created_on and source_id');
  if (createdOn < previous.last_created_on
    || (createdOn === previous.last_created_on && sourceId <= previous.last_source_id)) {
    throw new Error(`Raw input keyset is not strictly increasing at ${record.source_record_id}`);
  }
  return { createdOn, sourceId };
}

async function rpc(runConfig, functionName, body, fetchImpl = fetch) {
  const response = await fetchImpl(`${runConfig.baseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: runConfig.key,
      Authorization: `Bearer ${runConfig.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${functionName} failed (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function submitBatch(runConfig, checkpoint, records, fetchImpl = fetch) {
  if (!records.length) return null;
  const previous = {
    last_created_on: checkpoint.last_created_on,
    last_source_id: checkpoint.last_source_id,
  };
  let cursor = previous;
  for (const record of records) {
    if (record.contract !== CONTRACT) throw new Error(`Unsupported source contract: ${record.contract}`);
    cursor = compareCursor(cursor, record);
    cursor = { last_created_on: cursor.createdOn, last_source_id: cursor.sourceId };
  }
  const batchToken = crypto.createHash('sha256')
    .update(stableJson({
      run_key: runConfig.runKey,
      sequence: checkpoint.batch_sequence + 1,
      hashes: records.map(record => record.raw_sha256),
    }))
    .digest('hex');
  const result = await rpc(runConfig, 'ingest_mariadb_raw_batch', {
    p_run_key: runConfig.runKey,
    p_batch_token: batchToken,
    p_contract: CONTRACT,
    p_expected_last_created_on: previous.last_created_on,
    p_expected_last_source_id: previous.last_source_id,
    p_next_last_created_on: cursor.last_created_on,
    p_next_last_source_id: cursor.last_source_id,
    p_records: records,
  }, fetchImpl);
  if (Number(result?.input_rows) !== records.length
    || Number(result?.version_rows_inserted || 0) + Number(result?.version_rows_existing || 0) !== records.length
    || Number(result?.error_rows || 0) !== 0) {
    throw new Error('Raw-import RPC counts do not reconcile with the submitted batch');
  }
  return result;
}

async function run(options = {}) {
  const runConfig = options.config || config();
  const fetchImpl = options.fetchImpl || fetch;
  const files = discoverInputFiles(runConfig.input);
  const prepared = prepareOutput(runConfig, files);
  const state = { ...prepared.checkpoint };
  let records = [];

  async function flush(nextFileIndex, nextLineIndex) {
    if (!records.length) return;
    const result = await submitBatch(runConfig, state, records, fetchImpl);
    state.batch_sequence += 1;
    state.input_rows += Number(result.input_rows);
    state.envelope_rows_inserted += Number(result.envelope_rows_inserted || 0);
    state.version_rows_inserted += Number(result.version_rows_inserted || 0);
    state.version_rows_existing += Number(result.version_rows_existing || 0);
    state.error_rows += Number(result.error_rows || 0);
    state.last_created_on = result.last_created_on;
    state.last_source_id = result.last_source_id;
    state.file_index = nextFileIndex;
    state.line_index = nextLineIndex;
    state.updated_at = new Date().toISOString();
    atomicJson(prepared.paths.checkpoint, state);
    process.stdout.write(`${JSON.stringify({ event: 'mariadb_raw_import_checkpoint', ...result, batch_sequence: state.batch_sequence })}\n`);
    records = [];
  }

  for (let fileIndex = state.file_index; fileIndex < files.length; fileIndex += 1) {
    const lines = openLines(files[fileIndex]);
    let lineIndex = 0;
    for await (const line of lines) {
      lineIndex += 1;
      if (fileIndex === state.file_index && lineIndex <= state.line_index) continue;
      if (!line.trim()) continue;
      records.push(JSON.parse(line));
      if (records.length >= runConfig.batchSize) await flush(fileIndex, lineIndex);
    }
    await flush(fileIndex + 1, 0);
    if (state.file_index <= fileIndex) {
      state.file_index = fileIndex + 1;
      state.line_index = 0;
      state.updated_at = new Date().toISOString();
      atomicJson(prepared.paths.checkpoint, state);
    }
  }

  const completion = await rpc(runConfig, 'complete_mariadb_raw_import', {
    p_run_key: runConfig.runKey,
    p_expected_rows: state.input_rows,
    p_expected_last_created_on: state.last_created_on,
    p_expected_last_source_id: state.last_source_id,
  }, fetchImpl);
  state.complete = completion?.status === 'RAW_COPY_COMPLETE';
  state.completed_at = new Date().toISOString();
  const reconciled = state.input_rows === state.version_rows_inserted + state.version_rows_existing
    && state.error_rows === 0
    && state.complete;
  const report = {
    ...state,
    reconciled,
    watch_records_writes: 0,
    normalization_writes: 0,
  };
  atomicJson(prepared.paths.reconciliation, report);
  atomicJson(prepared.paths.checkpoint, state);
  if (!reconciled) throw new Error('Completed raw import did not reconcile');
  process.stdout.write(`${JSON.stringify({ event: 'mariadb_raw_import_complete', ...report })}\n`);
  return report;
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`${JSON.stringify({ event: 'mariadb_raw_import_error', error_name: error.name || 'Error', error_message: error.message || String(error), watch_records_writes: 0, normalization_writes: 0 })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  IMPORT_CONTRACT,
  compareCursor,
  config,
  discoverInputFiles,
  inputFingerprint,
  prepareOutput,
  rpc,
  run,
  submitBatch,
};
