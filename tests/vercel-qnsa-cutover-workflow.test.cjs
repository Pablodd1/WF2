'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'vercel-qnsa-cutover.yml'), 'utf8');

test('cutover is pinned and explicitly authorized', () => {
  assert.match(workflow, /CUTOVER_VERCEL_TO_QNSA/);
  assert.match(workflow, /SUPABASE_PROJECT_REF: qnsafosakvonzgfcsphh/);
  assert.match(workflow, /input_rows -ne 1394269/);
});

test('cutover requires both release controls enabled', () => {
  assert.match(workflow, /trading_floor_enabled -ne \$true/);
  assert.match(workflow, /price_research_enabled -ne \$true/);
});

test('secrets are retrieved and masked without artifacts', () => {
  assert.match(workflow, /api-keys\?reveal=true/);
  assert.match(workflow, /::add-mask::/);
  assert.doesNotMatch(workflow, /QNSA_SERVICE_KEY.*Upload/);
});

test('production variables and reviewed two-brand gates are updated', () => {
  for (const name of [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY', 'PUBLICATION_BRANDS', 'PUBLICATION_REFERENCES',
  ]) assert.match(workflow, new RegExp(`Set-VercelEnv '${name}'`));
  assert.match(workflow, /Rolex\|Patek Philippe/);
  assert.match(workflow, /ALL_REVIEWED/);
});

test('cutover snapshots and restores old production values on failure', () => {
  assert.match(workflow, /env pull \.env\.vercel\.rollback/);
  assert.match(workflow, /restoring previous production environment/);
  assert.match(workflow, /foreach \(\$name in \$names\)/);
});

test('post-deploy smoke tests cover QNSA health, Rolex trading and Patek price research', () => {
  assert.match(workflow, /api\/health/);
  assert.match(workflow, /database_project_ref/);
  assert.match(workflow, /rolex\.records/);
  assert.match(workflow, /brand=Rolex&reference=116500LN/);
  assert.match(workflow, /brand=Patek%20Philippe&reference=5712/);
});
