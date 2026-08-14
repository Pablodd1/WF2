'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814100000_qnsa_later_brand_bounded_feed.sql'), 'utf8');
const inventory = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
const strictMigration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814110000_qnsa_later_brand_reference_gate.sql'), 'utf8');
const strictBoundMigration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814111500_qnsa_later_brand_reference_gate_bound.sql'), 'utf8');
const strictKeyMigration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814112000_qnsa_later_brand_reference_key_gate.sql'), 'utf8');
const strictWindowMigration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814112500_qnsa_later_brand_reference_window.sql'), 'utf8');
const workflow = fs.readFileSync(path.join(root,
  '.github/workflows/qnsa-later-brand-feed-hotfix.yml'), 'utf8');

test('later reviewed brands use a bounded existing-index feed without copying data', () => {
  assert.match(migration, /qnsa_later_brand_page_rows/);
  assert.match(migration, /p_brand NOT IN \('Richard Mille', 'Cartier'\)/);
  assert.match(migration, /ORDER BY l\.reference_normalized ASC NULLS LAST, l\.id ASC/);
  assert.match(migration, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\) \* 10, 1010\)/);
  assert.doesNotMatch(migration, /CREATE INDEX|INSERT INTO staging\.listings|UPDATE staging\.listings|DELETE FROM staging\.listings/);
  assert.match(inventory, /laterReviewedBrand \? 'qnsa_later_brand_page_rows_strict'/);
  assert.match(inventory, /isPlausibleLaterBrandReference/);
  assert.match(inventory, /qnsa_later_brand_page_rows/);
  assert.match(inventory, /laterReviewedBrand && qnsaBroadPage/);
  assert.match(inventory, /!hasObviousCrossBrandConflict\(row\)/);
  assert.match(inventory, /laterReviewedBrand && !pageRowsRes\.ok/);
  assert.match(inventory, /laterReviewedBrand && qnsaBroadPage && records\.length === 0/);
});

test('hotfix workflow is pinned, bounded, and adds no storage-heavy index', () => {
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /APPLY_QNSA_LATER_BRAND_FEED/);
  assert.match(workflow, /statement_timeout='20s'/);
  assert.match(workflow, /read_only = \$false/);
  assert.match(workflow, /qnsa_later_brand_page_rows_strict\('Richard Mille',21,0,NULL\)/);
  assert.match(workflow, /CREATE\\s\+INDEX/);
});

test('strict later-brand wrapper rejects parser-artifact references', () => {
  assert.match(strictMigration, /\^RM\[0-9\]\{2,3\}\(-\[0-9\]\{1,3\}\)\?\$/);
  assert.match(strictMigration, /\^W\[A-Z0-9\]\{5,15\}\$/);
  assert.match(strictMigration, /qnsa_later_brand_page_rows\(/);
  assert.doesNotMatch(strictMigration, /CREATE INDEX|INSERT INTO staging\.listings|UPDATE staging\.listings/);
  assert.match(workflow, /invalid_rows/);
  assert.match(workflow, /rm_reference_sample/);
});

test('strict later-brand wrapper stays inside the proven 51-row latency bound', () => {
  assert.match(strictBoundMigration, /LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\), 51\)/);
  assert.doesNotMatch(strictBoundMigration, /CREATE INDEX|INSERT INTO staging\.listings|UPDATE staging\.listings/);
  assert.match(workflow, /20260814111500_qnsa_later_brand_reference_gate_bound\.sql/);
});

test('strict later-brand gate normalizes punctuation without changing source references', () => {
  assert.match(strictKeyMigration, /regexp_replace\(/);
  assert.match(strictKeyMigration, /\^RM\[0-9\]\{3,6\}\[A-Z\]\{0,3\}\$/);
  assert.match(strictKeyMigration, /\^W\[A-Z0-9\]\{5,18\}\$/);
  assert.match(workflow, /20260814112000_qnsa_later_brand_reference_key_gate\.sql/);
});

test('strict later-brand gate reads one bounded page before filtering legacy artifacts', () => {
  assert.match(strictWindowMigration, /p_brand,\s*51,/);
  assert.match(strictWindowMigration, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\), 51\)/);
  assert.match(workflow, /20260814112500_qnsa_later_brand_reference_window\.sql/);
});

test('later-brand feed preserves immutable lineage and publication safety gates', () => {
  assert.match(migration, /JOIN public\.raw_message_versions AS rv/);
  assert.match(migration, /rv\.source_hash = l\.source_hash/);
  assert.match(migration, /bundle_status', 'SINGLE_CANDIDATE/);
  assert.match(migration, /suppressed_exact_duplicate/);
  assert.match(migration, /upper\(COALESCE\(l\.category, ''\)\) = 'WATCH'/);
  assert.match(inventory, /'QNSA_REVIEWED_LATER_BRAND_V1'/);
});
