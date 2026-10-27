/**
 * Shipvera Authentication & Multi-Tenant Seller Workspace API
 * Backed by Supabase Cloud PostgreSQL and Local In-Memory Fast Cache
 * Pure Pay-As-You-Go Architecture (Zero Free Credits, ₹6/Order)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../db');
const { getSupabaseClient } = require('../services/supabaseClient');
const { exchangeShopifyOAuthToken, verifyShopifyCredentials, registerShopifyWebhook, fetchShopifyOrders } = require('../services/shopifyClient');
const { shiprocketLogin, fetchShiprocketOrders } = require('../services/shiprocketClient');

/**
 * POST /api/auth/signup
 * Creates a brand new seller workspace in both Supabase PostgreSQL and local cache
 */
router.post('/signup', async (req, res) => {
  try {
    const { name, brand_name, email, phone, shopify_domain, password, platform_type } = req.body || {};

    if (!brand_name || !brand_name.trim()) {
      return res.status(400).json({ error: 'Brand or Store name is required.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Valid business email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Check local cache
    let existing = db.getSellerByEmail(cleanEmail);

    // 2. Check Supabase cloud if not in local cache
    if (!existing) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb.from('sellers').select('*').eq('email', cleanEmail).maybeSingle();
          if (data && !error) {
            existing = db.createSeller(data);
          }
        } catch (sbErr) {
          console.warn('[SUPABASE] Cloud lookup notice:', sbErr.message);
        }
      }
    }

    if (existing) {
      return res.status(200).json({
        success: true,
        isExisting: true,
        message: `Welcome back to ${existing.brand_name}!`,
        seller: {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          brand_name: existing.brand_name,
          phone: existing.phone,
          shopify_domain: existing.shopify_domain,
          wallet_balance_inr: existing.wallet_balance_inr
        },
        token: `token_${existing.id}`
      });
    }

    // Determine domain
    let domain = (shopify_domain || '').trim();
    if (platform_type === 'reseller' || !domain) {
      const sanitized = brand_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      domain = `${sanitized}.myshopify.com`;
    }

    // 3. Create fresh seller in local store (Strictly ₹0.00 wallet balance)
    const newSeller = db.createSeller({
      name: (name || brand_name).trim(),
      brand_name: brand_name.trim(),
      email: cleanEmail,
      phone: (phone || '').trim(),
      shopify_domain: domain,
      password: password || ''
    });

    // 4. Asynchronously persist to Supabase Cloud PostgreSQL
    const sb = getSupabaseClient();
    if (sb) {
      try {
        const { error: insertError } = await sb.from('sellers').insert([{
          email: newSeller.email,
          brand_name: newSeller.brand_name,
          phone: newSeller.phone,
          shopify_domain: newSeller.shopify_domain,
          wallet_balance_inr: 0.00,
          plan_tier: 'pay_as_you_go'
        }]);
        if (insertError) {
          console.warn('[SUPABASE] Cloud insert notice:', insertError.message);
        } else {
          console.log(`[SUPABASE] ✅ Successfully saved seller "${newSeller.brand_name}" (${newSeller.email}) to Supabase Cloud PostgreSQL.`);
        }
      } catch (cloudErr) {
        console.warn('[SUPABASE] Cloud sync catch:', cloudErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Workspace created successfully! Initialized in Pure Pay-As-You-Go mode (₹6/Order).',
      seller: {
        id: newSeller.id,
        name: newSeller.name,
        email: newSeller.email,
        brand_name: newSeller.brand_name,
        phone: newSeller.phone,
        shopify_domain: newSeller.shopify_domain,
        wallet_balance_inr: 0.00
      },
      token: `token_${newSeller.id}`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/login
 * Seller login by email with Supabase Cloud fallback
 */
router.post('/login', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    let seller = db.getSellerByEmail(cleanEmail);

    // Check Supabase Cloud if not found in local memory
    if (!seller) {
      const sb = getSupabaseClient();
      if (sb) {
        try {
          const { data, error } = await sb.from('sellers').select('*').eq('email', cleanEmail).maybeSingle();
          if (data && !error) {
            seller = db.createSeller(data);
          }
        } catch (sbErr) {
          console.warn('[SUPABASE] Cloud login check notice:', sbErr.message);
        }
      }
    }

    if (!seller) {
      return res.status(404).json({ error: 'No workspace found with this email. Please create a new workspace.' });
    }

    return res.status(200).json({
      success: true,
      seller: {
        id: seller.id,
        name: seller.name,
        email: seller.email,
        brand_name: seller.brand_name,
        phone: seller.phone,
        shopify_domain: seller.shopify_domain,
        wallet_balance_inr: seller.wallet_balance_inr
      },
      token: `token_${seller.id}`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/sellers
 * List available seller workspaces for store switcher
 * Enforces strict multi-tenant isolation:
 * - A logged-in merchant only sees workspaces registered to their email/account.
 * - Lists only sellers that were actually created; no demo store is injected.
 * - Prevents cross-tenant account switching and information leakage.
 */
router.get('/sellers', async (req, res) => {
  try {
    const requesterEmail = (req.headers['x-seller-email'] || req.query.email || '').trim().toLowerCase();
    const requesterSellerId = (req.headers['x-seller-id'] || req.query.seller_id || '').trim();

    let allSellers = db.getAllSellers();
    
    // Check Supabase Cloud if user has cloud-registered workspaces
    const sb = getSupabaseClient();
    if (sb && requesterEmail) {
      try {
        const { data } = await sb.from('sellers').select('*').eq('email', requesterEmail).limit(10);
        if (data && Array.isArray(data)) {
          for (const cloudSeller of data) {
            if (!allSellers.some(s => s.id === cloudSeller.id)) {
              allSellers.push(db.createSeller(cloudSeller));
            }
          }
        }
      } catch (e) {}
    }

    const resultSellers = [];
    const seen = new Set();

    // 1. Add current merchant's own workspaces
    for (const s of allSellers) {
      const isOwner = (requesterEmail && s.email && s.email.toLowerCase() === requesterEmail) ||
                      (requesterSellerId && s.id === requesterSellerId);
      if (isOwner && !seen.has(s.id)) {
        seen.add(s.id);
        resultSellers.push({
          id: s.id,
          brand_name: s.brand_name,
          name: s.name,
          email: s.email,
          phone: s.phone,
          shopify_domain: s.shopify_domain,
          wallet_balance_inr: s.wallet_balance_inr,
          is_demo: false
        });
      }
    }

    // No demo store is injected here. A fresh install lists only
    // sellers that were actually created.

    return res.status(200).json({ success: true, sellers: resultSellers });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/connect-shopify
 * Live verification & auto-configuration of merchant's Shopify store:
 * 1. Verifies credentials against live Shopify REST API (GET /admin/api/2024-10/shop.json)
 * 2. Auto-registers 'orders/create' webhook directly on their store (POST /admin/api/2024-10/webhooks.json)
 * 3. Auto-imports recent open COD orders from their store to populate their dashboard with real data
 * 4. Syncs updated workspace to Supabase PostgreSQL cloud
 */
router.post('/connect-shopify', async (req, res) => {
  try {
    const { seller_id, shopify_domain, shopify_access_token } = req.body || {};
    const sellerId = seller_id || req.headers['x-seller-id'] || null;
    if (!sellerId) {
      return res.status(404).json({ error: 'Seller not found. Provide seller_id; no fallback seller is used.' });
    }

    if (!sellerId) {
      return res.status(400).json({ error: 'Active seller ID is required.' });
    }
    if (!shopify_domain || !shopify_domain.trim()) {
      return res.status(400).json({ error: 'Shopify Store Domain is required (e.g. yourstore.myshopify.com).' });
    }

    const cleanDomain = shopify_domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const cleanToken = (shopify_access_token || '').trim();

    const seller = db.getSeller(sellerId);
    if (!seller) {
      return res.status(404).json({ error: 'Seller workspace not found. Provide a valid seller_id.' });
    }

    // Step 1: Live Credential Handshake with Shopify Admin API
    console.log(`[SHOPIFY CONNECT] Verifying credentials for store "${cleanDomain}"...`);
    const verifyResult = await verifyShopifyCredentials({
      shopifyDomain: cleanDomain,
      accessToken: cleanToken
    });

    if (!verifyResult.success) {
      return res.status(400).json({
        success: false,
        error: `Shopify Verification Failed: ${verifyResult.error}. Please ensure your Custom App is created in Shopify Admin with 'read_orders' and 'write_orders' scopes enabled.`
      });
    }

    const shopMeta = verifyResult.shop || {};
    console.log(`[SHOPIFY CONNECT] Verified shop: "${shopMeta.name || cleanDomain}" (${shopMeta.email || 'no email'})`);

    // Step 2: Auto-Register Webhook on Shopify Store
    const host = req.get('x-forwarded-host') || req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const webhookUrl = `${protocol}://${host}/api/webhooks/shopify/orders-create?seller_id=${seller.id}`;

    console.log(`[SHOPIFY CONNECT] Registering webhook "${webhookUrl}" on store "${cleanDomain}"...`);
    const webhookResult = await registerShopifyWebhook({
      shopifyDomain: cleanDomain,
      accessToken: cleanToken,
      webhookUrl,
      topic: 'orders/create'
    });

    // Step 3: Update local DB & seller metadata
    seller.shopify_domain = cleanDomain;
    if (cleanToken) seller.shopify_access_token = cleanToken;
    if (shopMeta.name) {
      seller.brand_name = shopMeta.name;
    }
    seller.shopify_connected_at = new Date().toISOString();
    seller.shopify_webhook_active = webhookResult.success;
    seller.shopify_mode = verifyResult.mode || 'live';
    db.save();

    // Step 4: Persist to Supabase Cloud PostgreSQL
    const sb = getSupabaseClient();
    if (sb) {
      try {
        await sb.from('sellers').update({
          shopify_domain: cleanDomain,
          shopify_access_token: cleanToken || null,
          brand_name: seller.brand_name
        }).eq('id', sellerId);
      } catch (sbErr) {
        console.warn('[SUPABASE] Cloud sync notice on connect-shopify:', sbErr.message);
      }
    }

    // Step 5: Auto-Import recent open orders from their live Shopify store
    let syncedOrdersCount = 0;
    try {
      const ordersResult = await fetchShopifyOrders({
        shopifyDomain: cleanDomain,
        accessToken: cleanToken,
        limit: 10,
        status: 'open'
      });

      if (ordersResult.success && Array.isArray(ordersResult.orders) && ordersResult.orders.length > 0) {
        for (const shopifyOrder of ordersResult.orders) {
          const externalId = shopifyOrder.name || `#${shopifyOrder.id}`;
          const existing = db.getOrders(seller.id).find(o => o.external_order_id === externalId);
          if (!existing) {
            const shipping = shopifyOrder.shipping_address || {};
            const rawAddress = `${shipping.address1 || ''} ${shipping.address2 || ''}`.trim() || 'No address provided';
            const city = shipping.city || 'India';
            const pincode = shipping.zip || '';
            const buyerName = `${shipping.first_name || 'Buyer'} ${shipping.last_name || ''}`.trim();
            const buyerPhone = shipping.phone || shopifyOrder.phone || shopifyOrder.customer?.phone || '';
            const codAmount = Number(shopifyOrder.total_price) || 0;
            const isCod = shopifyOrder.financial_status === 'pending' ||
                          (shopifyOrder.payment_gateway_names && shopifyOrder.payment_gateway_names.some(g => /cod|cash/i.test(g)));

            db.createOrder({
              seller_id: seller.id,
              external_order_id: externalId,
              source: 'shopify',
              buyer_name: buyerName || 'Customer',
              buyer_phone: buyerPhone || '+919999999999',
              cod_amount: codAmount,
              raw_address: rawAddress,
              city,
              pincode,
              missing_fields: rawAddress.length < 25 ? ['landmark', 'house_number'] : ['landmark'],
              verification_status: isCod ? 'queued' : 'verified_cleaned',
              risk_score: isCod ? 45 : 10,
              tags: isCod ? ['COD-Order', 'Shopify-Live-Sync'] : ['Prepaid-Order', 'Shopify-Live-Sync']
            });
            syncedOrdersCount++;
          }
        }
        console.log(`[SHOPIFY CONNECT] Ingested ${syncedOrdersCount} live open orders from ${cleanDomain}`);
      }
    } catch (importErr) {
      console.warn('[SHOPIFY CONNECT] Initial order sync notice:', importErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Shopify store ${cleanDomain} connected successfully! Live orders and webhooks active.`,
      shopify_domain: cleanDomain,
      shop: shopMeta,
      webhook_url: webhookUrl,
      webhook_active: webhookResult.success,
      synced_orders_count: syncedOrdersCount,
      event: 'orders/create'
    });
  } catch (err) {
    console.error('[SHOPIFY CONNECT ERROR]', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/shopify/install
 * 1-Click Shopify App OAuth Redirect URL (Initiates OAuth Flow)
 */
router.get('/shopify/install', (req, res) => {
  try {
    const shop = (req.query.shop || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const sellerId = req.query.seller_id || req.headers['x-seller-id'] || null;
    if (!sellerId) {
      return res.status(400).send('Missing seller_id. Provide ?seller_id= for the seller to link this Shopify store to.');
    }
    const apiKey = process.env.SHOPIFY_API_KEY;

    if (!shop) {
      return res.status(400).send('Missing ?shop=yourstore.myshopify.com parameter.');
    }

    if (!apiKey) {
      // If no public partner app key configured in env, guide to custom app
      return res.redirect(`/dashboard?seller_id=${sellerId}&connect_guide=custom_app&shop=${encodeURIComponent(shop)}`);
    }

    const host = req.get('x-forwarded-host') || req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const redirectUri = `${protocol}://${host}/api/auth/shopify/callback`;
    const scopes = 'read_orders,write_orders,read_customers';
    const state = Buffer.from(JSON.stringify({ seller_id: sellerId, shop })).toString('base64');

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    return res.redirect(authUrl);
  } catch (err) {
    return res.status(500).send(`OAuth Initiation Error: ${err.message}`);
  }
});

/**
 * GET /api/auth/shopify/callback
 * Shopify OAuth Callback: Exchanges authorization code for permanent access token
 */
router.get('/shopify/callback', async (req, res) => {
  try {
    const { shop, code, state } = req.query;
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;

    if (!shop || !code) {
      return res.status(400).send('Invalid OAuth callback parameters (missing shop or code).');
    }

    let sellerId = null;
    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
        if (decoded.seller_id) sellerId = decoded.seller_id;
      } catch (e) {}
    }

    const cleanDomain = shop.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    console.log(`[SHOPIFY OAUTH] Exchanging code for token on ${cleanDomain}...`);

    const exchangeResult = await exchangeShopifyOAuthToken({
      shopifyDomain: cleanDomain,
      code,
      clientId: apiKey,
      clientSecret: apiSecret
    });

    if (!exchangeResult.success) {
      return res.status(400).send(`OAuth Exchange Failed: ${exchangeResult.error}`);
    }

    const accessToken = exchangeResult.accessToken;
    const seller = (sellerId ? db.getSeller(sellerId) : null) || db.getSellerByShopifyDomain(cleanDomain);
    if (!seller) {
      return res.status(400).send('Seller not found for this Shopify OAuth callback. Create the seller first, then retry OAuth with that seller_id.');
    }

    seller.shopify_domain = cleanDomain;
    seller.shopify_access_token = accessToken;
    seller.shopify_connected_at = new Date().toISOString();
    db.save();

    // Auto-register webhook on Shopify
    const host = req.get('x-forwarded-host') || req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const webhookUrl = `${protocol}://${host}/api/webhooks/shopify/orders-create?seller_id=${seller.id}`;

    await registerShopifyWebhook({
      shopifyDomain: cleanDomain,
      accessToken,
      webhookUrl,
      topic: 'orders/create'
    });

    // Ingest open orders
    try {
      const ordersRes = await fetchShopifyOrders({
        shopifyDomain: cleanDomain,
        accessToken,
        limit: 10,
        status: 'open'
      });
      if (ordersRes.orders && Array.isArray(ordersRes.orders)) {
        for (const o of ordersRes.orders) {
          const externalId = o.name || `#${o.id}`;
          if (!db.getOrders(seller.id).some(existing => existing.external_order_id === externalId)) {
            const shipping = o.shipping_address || {};
            db.createOrder({
              seller_id: seller.id,
              external_order_id: externalId,
              source: 'shopify',
              buyer_name: `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim() || 'Customer',
              buyer_phone: shipping.phone || o.phone || '+919999999999',
              cod_amount: Number(o.total_price) || 0,
              raw_address: `${shipping.address1 || ''} ${shipping.address2 || ''}`.trim() || 'Address',
              city: shipping.city || 'India',
              pincode: shipping.zip || '',
              missing_fields: ['landmark'],
              verification_status: 'queued',
              risk_score: 40,
              tags: ['COD-Order', 'Shopify-OAuth-Sync']
            });
          }
        }
      }
    } catch (e) {}

    // Redirect to dashboard with success banner
    return res.redirect(`/dashboard?seller_id=${seller.id}&shopify_connected=true&store=${encodeURIComponent(cleanDomain)}`);
  } catch (err) {
    console.error('[SHOPIFY OAUTH CALLBACK ERROR]', err);
    return res.status(500).send(`Shopify OAuth Error: ${err.message}`);
  }
});

/**
 * POST /api/auth/connect-logistics
 * Connects logistics aggregator (Shiprocket, Delhivery, NimbusPost, or native Shopify)
 * Features live authentication with Shiprocket API
 */
router.post('/connect-logistics', async (req, res) => {
  try {
    const { seller_id, provider = 'shiprocket', token, email, password, client_id } = req.body || {};
    const sellerId = seller_id || req.headers['x-seller-id'] || null;
    if (!sellerId) {
      return res.status(404).json({ error: 'Seller not found. Provide seller_id; no fallback seller is used.' });
    }

    if (!sellerId) {
      return res.status(400).json({ error: 'Active seller ID is required.' });
    }

    const seller = db.getSeller(sellerId);
    if (!seller) {
      return res.status(404).json({ error: 'Seller workspace not found. Provide a valid seller_id.' });
    }

    // Save logistics provider configuration
    seller.logistics_provider = provider;

    if (provider === 'shiprocket') {
      if (email && password) {
        console.log(`[SHIPROCKET CONNECT] Authenticating with Shiprocket API for ${email}...`);
        const loginRes = await shiprocketLogin({ email, password });
        if (!loginRes.success) {
          return res.status(400).json({
            success: false,
            error: `Shiprocket Authentication Failed: ${loginRes.error || 'Invalid email or password'}`
          });
        }
        seller.shiprocket_token = loginRes.token;
        seller.shiprocket_email = email;
      } else if (token && token.trim()) {
        seller.shiprocket_token = token.trim();
      } else {
        return res.status(400).json({
          success: false,
          error: 'Shiprocket connection requires either email and password, or an active Shiprocket API token.'
        });
      }
    } else if (provider === 'delhivery') {
      if (!token && !client_id) {
        return res.status(400).json({
          success: false,
          error: 'Delhivery connection requires an API token or Client ID.'
        });
      }
      seller.delhivery_token = (token || client_id).trim();
    } else if (provider === 'nimbuspost') {
      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'NimbusPost connection requires an API key.'
        });
      }
      seller.nimbuspost_key = token.trim();
    }

    seller.logistics_connected_at = new Date().toISOString();
    db.save();

    // Sync to Supabase Cloud if connected
    const sb = getSupabaseClient();
    if (sb) {
      try {
        await sb.from('sellers').update({
          shiprocket_token: seller.shiprocket_token || null
        }).eq('id', seller.id || sellerId);
      } catch (e) {}
    }

    const providerNames = {
      shiprocket: 'Shiprocket',
      delhivery: 'Delhivery Direct',
      nimbuspost: 'NimbusPost',
      shopify_native: 'Shopify Native Sync'
    };

    return res.status(200).json({
      success: true,
      message: `${providerNames[provider] || provider} connected and active!`,
      provider,
      providerName: providerNames[provider] || provider,
      status: 'active'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/me
 * Get current seller info
 */
router.get('/me', (req, res) => {
  try {
    const sellerId = req.headers['x-seller-id'] || req.query.seller_id;
    if (!sellerId) {
      return res.status(400).json({ error: 'x-seller-id header or seller_id query param is required' });
    }
    const seller = db.getSeller(sellerId);
    if (!seller) {
      return res.status(404).json({ error: 'Seller workspace not found' });
    }
    return res.status(200).json({ success: true, seller });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/status
 * Health & Supabase Cloud Connection Diagnostics
 */
router.get('/status', async (req, res) => {
  const sb = getSupabaseClient();
  let supabaseStatus = 'disconnected';
  let cloudSellerCount = 0;

  if (sb) {
    try {
      const { count, error } = await sb.from('sellers').select('*', { count: 'exact', head: true });
      if (!error) {
        supabaseStatus = 'connected_cloud_postgresql';
        cloudSellerCount = count || 0;
      }
    } catch (e) {
      supabaseStatus = 'connection_error';
    }
  }

  return res.status(200).json({
    status: 'healthy',
    supabase: {
      status: supabaseStatus,
      url: process.env.SUPABASE_URL ? 'Configured (Encrypted SSL)' : 'Not set',
      sellers_count: cloudSellerCount
    },
    local_sellers: db.getAllSellers().length,
    pricing: 'Pure Pay-As-You-Go (₹6/Order, Starting Balance ₹0.00)'
  });
});

module.exports = router;
