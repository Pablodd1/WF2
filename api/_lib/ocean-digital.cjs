'use strict';

// Ocean Digital PostgreSQL client for the live WF2 read views.
// This is a SEPARATE data path from Supabase — it reads the parsed/normalized
// listings that live ONLY in Ocean Digital (157.245.84.14:5432 watchfacts).
// Kept isolated so it cannot affect the Supabase-backed production API.

const { Pool } = require('pg');

let pool = null;
let poolConfig = null;

function getPool() {
  const host = process.env.WF2_PGHOST || '157.245.84.14';
  const port = Number(process.env.WF2_PGPORT || 5432);
  const db = process.env.WF2_PGDATABASE || 'watchfacts';
  const user = process.env.WF2_PGUSER || 'wf_app_rw';
  const password = process.env.WF2_PGPASSWORD;

  const nextConfig = `${host}:${port}:${db}:${user}`;
  if (!pool || poolConfig !== nextConfig) {
    if (!password) {
      throw new Error('Missing WF2_PGPASSWORD for Ocean Digital read');
    }
    pool = new Pool({
      host,
      port,
      database: db,
      user,
      password,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    poolConfig = nextConfig;
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  const res = await p.query(text, params);
  return res;
}

async function ping() {
  const r = await query('SELECT current_database(), current_user, now()');
  return r.rows[0];
}

module.exports = { getPool, query, ping };
