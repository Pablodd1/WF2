'use strict';
// Local smoke test of /api/ocean-trading-floor against LIVE Ocean Digital.
const handler = require('/home/jasme/wf2/api/ocean-trading-floor.js');
process.env.WF2_PGPASSWORD = process.env.WF2_PGPASSWORD || 'zXykA81diXkKiL5PkS9xAAxK';
const req = { method: 'GET', query: { page: '1', page_size: '3' } };
let status = 0, body = null;
const res = {
  setHeader(){},
  status(c){ status = c; return this; },
  json(obj){ body = obj; }
};
handler(req, res).then(() => {
  console.log('HTTP status:', status);
  console.log('total cards:', body && body.total);
  console.log('has_more:', body && body.has_more);
  console.log('sample card:', JSON.stringify((body && body.cards && body.cards[0]) || null, null, 2));
  process.exit(0);
}).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
