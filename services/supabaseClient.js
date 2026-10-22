/**
 * Shipvera Supabase Cloud Database Client
 * TRD Section 3.1 & 3.2
 * Production PostgreSQL persistence for Render / Cloud deployments
 */

let supabase = null;

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  if (supabase) {
    return supabase;
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(url, key, {
      auth: { persistSession: false }
    });
    console.log('[SUPABASE] Connected to Supabase Cloud PostgreSQL database.');
    return supabase;
  } catch (err) {
    console.warn('[SUPABASE] @supabase/supabase-js package not loaded yet or connection failed:', err.message);
    return null;
  }
}

module.exports = {
  getSupabaseClient
};
