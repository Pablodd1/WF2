'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root,
  'supabase/migrations/20260814100000_qnsa_later_brand_bounded_feed.sql'), 'utf8');
const inventory = fs.readFileSync(path.join(root, 'api/reviewed-market-inventory.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root,
  '.github/workflows/qnsa-later-brand-feed-hotfix.yml'), 'utf8');

test('later reviewed brands use a bounded existing-index feed without copying data', () => {
  assert.match(migration, /qnsa_later_brand_page_rows/);
  assert.match(migration, /p_brand NOT IN \('Richard Mille', 'Cartier'\)/);
  assert.match(migration, /ORDER BY l\.reference_normalized ASC NULLS LAST, l\.id ASC/);
  assert.match(migration, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\) \* 10, 1010\)/);
  assert.doesNotMatch(migration, /CREATE INDEX|INSERT INTO staging\.listings|UPDATE staging\.listings|DELETE FROM staging\.listings/);
  assert.match(inventory, /laterReviewedBrand \? 'qnsa_later_brand_page_rows'/);
});

test('hotfix workflow is pinned, bounded, and adds no storage-heavy index', () => {
  assert.match(workflow, /qnsafosakvonzgfcsphh/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /APPLY_QNSA_LATER_BRAND_FEED/);
  assert.match(workflow, /statement_timeout='8s'/);
  assert.match(workflow, /read_only = \$false/);
  assert.match(workflow, /qnsa_later_brand_page_rows\('Richard Mille',21,0,NULL\)/);
  assert.match(workflow, /CREATE\\s\+INDEX/);
});

test('later-brand feed preserves immutable lineage and publication safety gates', () => {
  assert.match(migration, /JOIN public\.raw_message_versions AS rv/);
  assert.match(migration, /rv\.source_hash = l\.source_hash/);
  assert.match(migration, /bundle_status', 'SINGLE_CANDIDATE/);
  assert.match(migration, /suppressed_exact_duplicate/);
  assert.match(migration, /upper\(COALESCE\(l\.category, ''\)\) = 'WATCH'/);
  assert.match(inventory, /'QNSA_REVIEWED_LATER_BRAND_V1'/);
});
