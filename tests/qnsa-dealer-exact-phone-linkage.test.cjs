'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815133000_qnsa_dealer_exact_phone_linkage.sql'), 'utf8');
const checkpointMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815160000_qnsa_dealer_linkage_completion_checkpoint.sql'), 'utf8');
const rawPhoneIndexMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815170000_qnsa_raw_version_phone_lookup_index.sql'), 'utf8');
const rawPhoneRepairMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260815171000_qnsa_dealer_raw_version_phone_linkage.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows',
  'qnsa-dealer-exact-phone-linkage.yml'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'tools', 'dealer-directory',
  'run-exact-phone-linkage.cjs'), 'utf8');
const importer = fs.readFileSync(path.join(root, 'tools', 'dealer-directory',
  'import-canonical-snapshots.cjs'), 'utf8');

test('linkage is bounded and keyset-driven', () => {
  assert.match(migration, /p_after_id uuid DEFAULT NULL/i);
  assert.match(migration, /p_after_id IS NULL OR l\.id > p_after_id/i);
  assert.match(migration, /ORDER BY l\.id[\s\S]*LIMIT v_limit \+ 1/i);
  assert.doesNotMatch(migration, /CREATE\s+(?:UNIQUE\s+)?INDEX|OFFSET/i);
  assert.match(runner, /EXPLAIN \(FORMAT TEXT, COSTS TRUE\)/);
});

test('forward repair discovers exact phones through indexed immutable raw lineage', () => {
  const oldMarker = '$old$';
  const oldStart = rawPhoneRepairMigration.indexOf(oldMarker) + oldMarker.length;
  const oldEnd = rawPhoneRepairMigration.indexOf(oldMarker, oldStart);
  const auditedOldFragment = rawPhoneRepairMigration.slice(oldStart, oldEnd).replaceAll('\r\n', '\n');
  assert.ok(migration.replaceAll('\r\n', '\n').includes(auditedOldFragment),
    'forward repair must exactly match the currently installed candidate query');
  assert.match(rawPhoneIndexMigration,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qnsa_raw_versions_from_phone/i);
  assert.match(rawPhoneIndexMigration, /raw_payload#>>'\{raw_data,from_number\}'/i);
  assert.match(rawPhoneIndexMigration, /normalize_seller_phone_identity/i);
  assert.doesNotMatch(rawPhoneIndexMigration, /BEGIN|COMMIT|UPDATE|DELETE|TRUNCATE/i);
  assert.match(rawPhoneRepairMigration,
    /FROM public\.raw_message_versions AS raw_version[\s\S]*JOIN staging\.listings AS l[\s\S]*l\.raw_message_version_id = raw_version\.id/i);
  assert.match(rawPhoneRepairMigration,
    /raw_version\.raw_payload#>>'\{raw_data,from_number\}'[\s\S]*= ANY \(v_phones\)/i);
  assert.match(rawPhoneRepairMigration, /indisvalid[\s\S]*indisready/i);
  assert.doesNotMatch(rawPhoneRepairMigration,
    /UPDATE\s+(?:public\.raw_message_versions|staging\.listings)|DELETE\s+FROM|TRUNCATE/i);
  assert.match(runner, /idx_qnsa_raw_versions_from_phone/);
  assert.match(runner,
    /FROM public\.raw_message_versions AS raw_version[\s\S]*listing\.raw_message_version_id=raw_version\.id/i);
});

test('only exact verified unique phone identities may reach the private ledger', () => {
  assert.match(migration, /verification_status = 'VERIFIED'/);
  assert.match(migration, /upper\(identity\.identity_type\) IN \('PHONE', 'WHATSAPP'\)/);
  assert.match(migration, /HAVING count\(DISTINCT identity\.dealer_id\) > 1/);
  assert.match(migration, /'EXACT_VERIFIED_PHONE', 'APPLIED'/);
  assert.match(migration, /ON CONFLICT \(listing_id\) DO NOTHING/);
  assert.doesNotMatch(migration, /contact_consent\s*=/i);
  assert.doesNotMatch(migration, /UPDATE\s+(?:raw|staging)\.|DELETE\s+FROM\s+(?:raw|staging)\.|INSERT\s+INTO\s+(?:raw|staging)\./i);
});

test('release gates fail closed for lineage, bundles, status, and controlled brands', () => {
  assert.match(migration, /JOIN public\.raw_message_versions/);
  assert.match(migration, /raw_version\.source_record_id = l\.source_record_id/);
  assert.match(migration, /raw_version\.source_hash = l\.source_hash/);
  assert.match(migration, /release_control\.enabled_run_key = l\.normalization_run_key/);
  assert.match(migration, /release_control\.trading_floor_enabled = true/);
  assert.match(migration, /l\.provenance_metadata->>'bundle_status' = 'SINGLE_CANDIDATE'/);
  assert.doesNotMatch(migration, /COALESCE\(l\.provenance_metadata->>'bundle_status',\s*'SINGLE_CANDIDATE'\)/i);
  for (const state of ['bundle_child_pending_review', 'bundle_pending_separation', 'suppressed_exact_duplicate']) {
    assert.match(migration, new RegExp(state));
  }
  assert.match(migration, /zenith_audit\.decision = 'RELEASE_SAFE'/);
  assert.match(migration, /Richard Mille[\s\S]*Cartier[\s\S]*Zenith/);
});

test('RPC is service-only and returns no contact value', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.qnsa_dealer_exact_phone_link_page[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]{0,180}TO anon|GRANT EXECUTE[\s\S]{0,180}TO authenticated/i);
  const returnStart = migration.indexOf("RETURN jsonb_build_object(\n    'dealer_id'");
  const returnBlock = migration.slice(returnStart, migration.indexOf('END;\n$$;', returnStart));
  assert.doesNotMatch(returnBlock, /'phone'|'source_identity'|'seller_phone'/i);
});

test('workflow pins QNSA and separates audit, ten-row canary, and full modes', () => {
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /options: \[audit, canary, full\]/);
  assert.match(workflow, /AUDIT_QNSA_DEALER_LINKAGE/);
  assert.match(workflow, /CANARY_QNSA_DEALER_LINKAGE/);
  assert.match(workflow, /FULL_QNSA_DEALER_LINKAGE/);
  assert.match(workflow, /LINKAGE_CANARY_LIMIT: '10'/);
  assert.match(workflow, /Install concurrent immutable-evidence phone lookup/);
  assert.match(workflow, /idx_qnsa_raw_versions_from_phone/);
  assert.match(workflow, /import-canonical-snapshots\.cjs/);
  assert.match(workflow, /inputs\.mode != 'audit'/);
  assert.match(workflow, /\$compileSql = \$migration -replace/);
  assert.match(workflow, /BEGIN;`n\$compileSql`nROLLBACK;/);
  assert.match(workflow, /read_only = \$true/);
  assert.match(runner, /mode === 'audit'.*applied_links/s);
  assert.match(runner, /totals\.applied > canaryLimit/);
  assert.match(runner, /duplicate_verified_phones/);
  assert.match(runner, /orphan_links/);
  assert.match(runner, /qnsa_dealer_linkage_reconciliation\(\) AS result', false, fetchImpl/);
  assert.match(runner, /pii_logged: false/);
});

test('only a fully exhausted per-dealer scan can publish completed linkage', () => {
  assert.match(checkpointMigration, /dealer_listing_linkage_checkpoints/);
  assert.match(checkpointMigration, /status IN \('RUNNING', 'COMPLETE', 'FAILED'\)/);
  assert.match(checkpointMigration, /status = 'COMPLETE' AND completed_at IS NOT NULL/);
  assert.match(checkpointMigration, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(runner, /mode === 'full'[\s\S]*status = 'RUNNING'/);
  assert.match(runner, /mode === 'full' && !stop[\s\S]*status = 'COMPLETE'/);
  assert.match(runner, /'cursor_exhausted', true/);
  assert.doesNotMatch(runner, /mode === 'canary'[\s\S]{0,300}status = 'COMPLETE'/);
});

test('private canonical identity import is idempotent, reconciled, and never runs the retired bucket linker', () => {
  assert.match(importer, /apply_qnsa_dealer_directory_snapshot/);
  assert.match(importer, /duplicate_verified_phones/);
  assert.match(importer, /pii_logged: false/);
  assert.doesNotMatch(importer, /sync_qnsa_dealer_public_listing_links_bucket/);
});

test('runner input validators fail closed', () => {
  const { boundedInteger, safeUuid, EXPECTED_PROJECT } = require('../tools/dealer-directory/run-exact-phone-linkage.cjs');
  assert.equal(EXPECTED_PROJECT, 'qnsafosakvonzgfcsphh');
  assert.equal(boundedInteger('10', 5, 1, 10, 'X'), 10);
  assert.throws(() => boundedInteger('11', 5, 1, 10, 'X'));
  assert.equal(safeUuid('00000000-0000-4000-8000-000000000000'), '00000000-0000-4000-8000-000000000000');
  assert.throws(() => safeUuid('not-a-uuid'));
});
