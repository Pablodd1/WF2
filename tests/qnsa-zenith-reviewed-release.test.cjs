'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260814180000_qnsa_zenith_reviewed_release.sql');
const workflow = read('.github/workflows/qnsa-zenith-reviewed-release.yml');
const research = read('api/price-research.js');
const inventory = read('api/reviewed-market-inventory.js');
const models = read('api/catalog-models.js');
const references = read('api/catalog-references.js');

test('Zenith release installs disabled and never rewrites immutable data', () => {
  assert.match(migration, /'Zenith', false, false/);
  assert.match(migration, /brand_normalized = 'Zenith'/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+(?:staging\.listings|public\.raw_messages|public\.raw_message_versions)/i);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE|TRUNCATE)[\s\S]{0,80}(?:staging\.listings|public\.raw_message_versions)/i);
});

test('Zenith workflow is QNSA-pinned and fails closed on lineage, bundle provenance, and multi risk', () => {
  assert.match(workflow, /PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /brand_normalized='Zenith'/);
  assert.match(workflow, /provenance_metadata->>'bundle_status'='SINGLE_CANDIDATE'/);
  assert.match(workflow, /Zenith immutable lineage failure/);
  assert.match(workflow, /Zenith multi-listing candidates require quarantine before release/);
  assert.match(workflow, /if\(\[long\]\$e\.high_confidence_multi_risk -ne 0\)/);
  assert.match(workflow, /'source_currency_counts'/);
  assert.match(workflow, /if \('\$\{\{ inputs\.mode \}\}' -eq 'enable' -and \[long\]\$e\.priced_wts -lt 1\)/);
});

test('Zenith uses QNSA bounded Price Research and appears in Trading discovery', () => {
  assert.match(research, /'richard mille', 'cartier', 'zenith'/);
  assert.match(research, /'Richard Mille', 'Cartier', 'Zenith'/);
  assert.match(inventory, /'Richard Mille', 'Cartier', 'Zenith'/);
});

test('Zenith catalog browse no longer invokes the retired text-ID workbook range', () => {
  assert.match(models, /brand: 'Zenith'[\s\S]*identity_source: 'PREAGGREGATED_CATALOG_INDEX'/);
  assert.match(references, /evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION'/);
  const zenithModelBranch = models.slice(models.indexOf("if (brand.toLowerCase() === 'zenith')"));
  const zenithReferenceBranch = references.slice(references.indexOf("if (brand.toLowerCase() === 'zenith')"));
  assert.doesNotMatch(zenithModelBranch.split('const catalogReferences = listCatalogReferences(brand)')[0], /loadReviewedZenithModels\(/);
  assert.doesNotMatch(zenithReferenceBranch.split('const catalogReferences = listCatalogReferences(brand, model)')[0], /loadReviewedZenithReferences\(/);
});

test('Zenith same-line multi-watch messages are detected while a single watch remains eligible', () => {
  const { multiItemRisk } = require('../api/_lib/unsplit-bundle-filter.cjs');
  assert.equal(multiItemRisk('Zenith 03.3100.3600/69 USD 8000').is_multi, false);
  assert.equal(multiItemRisk('Zenith 03.3100.3600/69 USD 8000, Zenith 03.9300.3620/51.I001 USD 12000').is_multi, true);
  assert.equal(multiItemRisk('Zenith 03.3100.3600/69 USD 8000, Rolex 126500LN USD 30000').is_multi, true);
});
