const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-server-key';

const handler = require('../api/ingest.js');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function runQuery(query) {
  let requestedUrl = '';
  const originalFetch = global.fetch;
  global.fetch = async url => {
    requestedUrl = String(url);
    return new Response('[]', {
      status: 200,
      headers: { 'content-range': '0-0/0', 'content-type': 'application/json' },
    });
  };

  try {
    const res = responseRecorder();
    await handler({ method: 'GET', query }, res);
    assert.equal(res.statusCode, 200);
    return new URL(requestedUrl);
  } finally {
    global.fetch = originalFetch;
  }
}

test('recent inventory excludes recycle rows and undated imports', async () => {
  const url = await runQuery({ quality: 'market' });
  assert.equal(url.searchParams.get('or'), '(verdict.neq.RECYCLE,verdict.is.null)');
  assert.equal(url.searchParams.get('created_at'), 'not.is.null');
});

test('all inventory still excludes recycle rows but includes undated imports', async () => {
  const url = await runQuery({ quality: 'archive' });
  assert.equal(url.searchParams.get('or'), '(verdict.neq.RECYCLE,verdict.is.null)');
  assert.equal(url.searchParams.has('created_at'), false);
});

test('reference search reaches dated and undated non-recycle inventory', async () => {
  const url = await runQuery({ quality: 'market', q: '116500LN' });
  assert.equal(url.searchParams.get('or'), '(verdict.neq.RECYCLE,verdict.is.null)');
  assert.equal(url.searchParams.get('reference'), 'eq.116500LN');
  assert.equal(url.searchParams.has('created_at'), false);
});
