/**
 * Supabase migration tests. No network, no secrets, no live data.
 * They prove fail-closed behaviour without env vars and that the
 * migration SQL file contains the expected tables and no seed data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('supabaseDb fails closed with code NOT_CONFIGURED when env is missing', async () => {
  const saved = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_KEY: process.env.SUPABASE_KEY,
  };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_KEY;
  // Fresh module state so a cached client cannot hide the missing env.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('supabaseClient') || key.includes('supabaseDb')) delete require.cache[key];
  }
  const db = require('../services/supabaseDb');
  await assert.rejects(() => db.getSeller('x'), (e) => e.code === 'NOT_CONFIGURED');
  await assert.rejects(() => db.getOrders(), (e) => e.code === 'NOT_CONFIGURED');
  await assert.rejects(() => db.createOrder({ seller_id: 'x' }), (e) => e.code === 'NOT_CONFIGURED');
  for (const [k, v] of Object.entries(saved)) {
    if (v !== undefined) process.env[k] = v;
  }
});

test('supabaseClient reports not configured without env', () => {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('supabaseClient')) delete require.cache[key];
  }
  const saved = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_KEY: process.env.SUPABASE_KEY,
  };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_KEY;
  const { isSupabaseConfigured, getSupabaseClient } = require('../services/supabaseClient');
  assert.equal(isSupabaseConfigured(), false);
  assert.equal(getSupabaseClient(), null);
  for (const [k, v] of Object.entries(saved)) {
    if (v !== undefined) process.env[k] = v;
  }
});

test('migration SQL creates new tables, adds missing columns, and has no seed', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '001_trustorder_core.sql'), 'utf-8');
  for (const table of ['leads', 'otp_verifications', 'trust_locks']) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `missing ${table}`);
  }
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS name'));
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS password_hash'));
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS shopify_order_id'));
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS otp_status'));
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(!sql.includes('INSERT INTO sellers'), 'migration must not seed sellers');
  assert.ok(!sql.includes('snitch'), 'migration must not contain demo data');
  assert.ok(!sql.includes('shpat_'), 'migration must not contain demo tokens');
});
