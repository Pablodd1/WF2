const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workflowPath = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "supabase-targeted-lineage-migration.yml",
);

const workflow = fs.readFileSync(workflowPath, "utf8");

test("targeted lineage workflow is manual and explicitly confirmed", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /APPLY_PRIVATE_LINEAGE_SCHEMA/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
});

test("targeted lineage workflow executes only the two allowlisted migrations", () => {
  assert.match(workflow, /20260720220000_seller_listing_lineage_staging\.sql/);
  assert.match(workflow, /20260721120000_seller_child_lineage_staging\.sql/);
  assert.doesNotMatch(workflow, /db push/);
  assert.doesNotMatch(workflow, /--include-all/);
  assert.doesNotMatch(workflow, /supabase\/migrations\/\*/);
});

test("targeted lineage workflow fails atomically and verifies both tables", () => {
  assert.match(workflow, /BEGIN;/);
  assert.match(workflow, /COMMIT;/);
  assert.match(workflow, /ON_ERROR_STOP=1/);
  assert.match(workflow, /test \"\$result\" = \"2\"/);
  assert.match(workflow, /environment: production/);
});
