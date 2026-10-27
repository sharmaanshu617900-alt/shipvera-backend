/**
 * Shipvera Supabase Cloud Database Client.
 *
 * Canonical env vars for this migration:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 * Legacy names SUPABASE_SERVICE_ROLE_KEY and SUPABASE_KEY are accepted
 * as fallbacks only, so existing deployments do not break silently.
 * The key is server-side only. Never expose it to the browser and
 * never commit it. If no key is configured, getSupabaseClient()
 * returns null and callers must fail closed with NOT_CONFIGURED.
 * They must never fall back to local JSON in production.
 */

let supabase = null;

function getSupabaseEnv() {
  return {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_KEY
      || '',
  };
}

function isSupabaseConfigured() {
  const { url, key } = getSupabaseEnv();
  return Boolean(url && key);
}

function getSupabaseClient() {
  const { url, key } = getSupabaseEnv();
  if (!url || !key) {
    return null;
  }
  if (supabase) {
    return supabase;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(url, key, {
      auth: { persistSession: false },
    });
    return supabase;
  } catch (err) {
    console.warn('[SUPABASE] @supabase/supabase-js not loaded:', err.message);
    return null;
  }
}

module.exports = {
  getSupabaseClient,
  isSupabaseConfigured,
  getSupabaseEnv,
};
