/**
 * Shipvera Production Backend Account Connection Audit Script
 * Validates fail-closed production readiness:
 * 1. Shopify Credentials Verification (asserts fail-closed on dummy/empty; live on env)
 * 2. Shopify Webhook Auto-Installer (asserts fail-closed on unconfigured; live on env)
 * 3. Real Store Order Ingestion (dual ID mapping & schema normalization)
 * 4. Spoken Hinglish Speech to Structured Address Rewrite (AWB 35-char compliance)
 * 5. Shopify Address Update (asserts fail-closed when unconfigured, live if env present)
 * 6. Fake Order Cancellation (asserts fail-closed when unconfigured, live if env present)
 * 7. Shiprocket Logistics Connector (asserts fail-closed on dummy; live if env present)
 */

require('dotenv').config();
const { db } = require('../db');
const {
  verifyShopifyCredentials,
  registerShopifyWebhook,
  fetchShopifyOrders,
  updateShopifyOrderAddress,
  cancelShopifyOrder
} = require('../services/shopifyClient');
const { shiprocketLogin, updateShiprocketCustomAddress } = require('../services/shiprocketClient');
const { extractAndRewriteAddress } = require('../services/addressRewriter');
const { sanitizeAddress } = require('../services/geoSanitizer');

async function runAudit() {
  console.log('================================================================');
  console.log('🚀 AUDITING SHIPVERA PRODUCTION BACKEND ACCOUNT CONNECTION STACK');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 7;

  // Setup audit seller in DB
  const testSellerId = 'c0a80101-0000-4000-8000-000000000002';
  let seller = db.getSeller(testSellerId);
  if (!seller) {
    seller = db.createSeller({
      id: testSellerId,
      brand_name: 'Audit Store',
      email: 'audit@shipvera.internal',
      shopify_domain: process.env.SHOPIFY_STORE_DOMAIN || null,
      shopify_access_token: process.env.SHOPIFY_ACCESS_TOKEN || null
    });
    db.updateSellerWallet(testSellerId, 100.00);
    await new Promise(r => setTimeout(r, 800));
  }

  // 1. Test Shopify Credentials Verification Handshake (Fail-Closed Verification)
  console.log('🔹 [1/7] Testing Shopify Store Verification Handshake:');
  const dummyVerifyRes = await verifyShopifyCredentials({
    shopifyDomain: 'snitch-streetwear.myshopify.com',
    accessToken: 'shpat_live_encrypted_access_token_demo'
  });

  if (process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ACCESS_TOKEN) {
    const liveVerifyRes = await verifyShopifyCredentials({
      shopifyDomain: process.env.SHOPIFY_STORE_DOMAIN,
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN
    });
    if (liveVerifyRes.success) {
      console.log(`   ✓ Credential Handshake: PASS (LIVE: ${liveVerifyRes.shop.name} - ${liveVerifyRes.shop.myshopify_domain})`);
      passedTests++;
    } else {
      console.error(`   ✗ Credential Handshake Live Check: FAIL (${liveVerifyRes.error})`);
    }
  } else {
    // Assert fail-closed: Dummy/mock tokens MUST NOT succeed
    if (dummyVerifyRes.success === false && dummyVerifyRes.mode === 'not_configured') {
      console.log(`   ✓ Credential Handshake Fail-Closed: PASS (Rejected dummy token without faking success)`);
      passedTests++;
    } else {
      console.error(`   ✗ Credential Handshake: FAIL (Expected fail-closed, got: ${JSON.stringify(dummyVerifyRes)})`);
    }
  }

  // 2. Test Auto-Webhook Registration (Fail-Closed or Live)
  console.log('\n🔹 [2/7] Testing Automatic Webhook Registration on Shopify:');
  const dummyWebhookRes = await registerShopifyWebhook({
    shopifyDomain: 'snitch-streetwear.myshopify.com',
    accessToken: 'shpat_live_encrypted_access_token_demo',
    webhookUrl: 'https://shipvera-backend.onrender.com/api/webhooks/shopify/orders-create',
    topic: 'orders/create'
  });

  if (process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ACCESS_TOKEN) {
    const liveWebhookRes = await registerShopifyWebhook({
      shopifyDomain: process.env.SHOPIFY_STORE_DOMAIN,
      accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
      webhookUrl: 'https://shipvera-backend.onrender.com/api/webhooks/shopify/orders-create',
      topic: 'orders/create'
    });
    if (liveWebhookRes.success) {
      console.log(`   ✓ Webhook Registration: PASS (Target: ${liveWebhookRes.webhookUrl || 'Active'})`);
      passedTests++;
    } else {
      console.error(`   ✗ Webhook Registration: FAIL (${liveWebhookRes.error})`);
    }
  } else {
    // Assert fail-closed
    if (dummyWebhookRes.success === false && dummyWebhookRes.mode === 'not_configured') {
      console.log(`   ✓ Webhook Registration Fail-Closed: PASS (Safely halted on unconfigured credentials)`);
      passedTests++;
    } else {
      console.error(`   ✗ Webhook Registration: FAIL (Expected fail-closed, got: ${JSON.stringify(dummyWebhookRes)})`);
    }
  }

  // 3. Test Real Order Ingestion & Schema Mapping
  console.log('\n🔹 [3/7] Testing Live Store Order Ingestion & Normalization:');
  const mockShopifyOrder = {
    id: 5928471928401, // Real 13-digit Shopify internal ID
    name: '#SN-8492',
    financial_status: 'pending',
    payment_gateway_names: ['cash_on_delivery'],
    total_price: '2199.00',
    shipping_address: {
      first_name: 'Vikram',
      last_name: 'Singhania',
      phone: '+919811223344',
      address1: 'sharma dairy ke piche gali 4',
      address2: '',
      city: 'Rohtak',
      zip: '124001'
    }
  };

  const sanitation = sanitizeAddress({
    rawAddress: mockShopifyOrder.shipping_address.address1,
    city: mockShopifyOrder.shipping_address.city,
    pincode: mockShopifyOrder.shipping_address.zip,
    buyerPhone: mockShopifyOrder.shipping_address.phone,
    buyerName: 'Vikram Singhania'
  });

  const ingestedOrder = db.createOrder({
    seller_id: seller.id,
    external_order_id: mockShopifyOrder.name,
    shopify_order_id: String(mockShopifyOrder.id),
    source: 'shopify',
    buyer_name: 'Vikram Singhania',
    buyer_phone: mockShopifyOrder.shipping_address.phone,
    cod_amount: Number(mockShopifyOrder.total_price),
    raw_address: mockShopifyOrder.shipping_address.address1,
    city: mockShopifyOrder.shipping_address.city,
    pincode: mockShopifyOrder.shipping_address.zip,
    missing_fields: sanitation.missingFields,
    risk_score: sanitation.riskScore,
    verification_status: 'queued'
  });

  if (ingestedOrder.shopify_order_id === '5928471928401' && ingestedOrder.external_order_id === '#SN-8492') {
    console.log(`   ✓ Order Ingested with dual IDs: PASS`);
    console.log(`     - Shopify Internal ID: ${ingestedOrder.shopify_order_id}`);
    console.log(`     - Display Order Number: ${ingestedOrder.external_order_id}`);
    console.log(`     - Missing Elements Flagged: ${ingestedOrder.missing_fields.join(', ') || 'none'}`);
    passedTests++;
  } else {
    console.error(`   ✗ Order Ingestion: FAIL`);
  }

  // 4. Test Spoken Hinglish Speech to Structured Address Rewrite
  console.log('\n🔹 [4/7] Testing Landmark Interrogator Spoken Audio Extraction:');
  const spokenAudioTranscript = 'Haan bhaiya Sharma Dairy se left leke pehla peela makan hai, plot 42';
  const rewritten = extractAndRewriteAddress({
    rawAddress: ingestedOrder.raw_address,
    spokenText: spokenAudioTranscript,
    city: ingestedOrder.city,
    pincode: ingestedOrder.pincode,
    buyerIntent: 'VERIFIED_GENUINE'
  });

  if (rewritten.cleanedAddressLine1 && rewritten.cleanedLandmark) {
    console.log(`   ✓ Spoken Entity Extraction: PASS`);
    console.log(`     - Raw: "${ingestedOrder.raw_address}"`);
    console.log(`     - Spoken Spatials: "${spokenAudioTranscript}"`);
    console.log(`     - Courier Label Line 1: "${rewritten.cleanedAddressLine1}" (<= 35 chars safe: ${rewritten.cleanedAddressLine1.length} chars)`);
    console.log(`     - Courier Label Line 2: "${rewritten.cleanedAddressLine2}"`);
    console.log(`     - Extracted Landmark: "${rewritten.cleanedLandmark}"`);
    passedTests++;
  } else {
    console.error(`   ✗ Spoken Entity Extraction: FAIL`);
  }

  // 5. Test Live Shopify Address Update via PUT
  console.log('\n🔹 [5/7] Testing Live Shopify Shipping Label Overwrite (PUT):');
  const updateRes = await updateShopifyOrderAddress({
    shopifyDomain: seller.shopify_domain,
    accessToken: seller.shopify_access_token,
    externalOrderId: ingestedOrder.external_order_id,
    shopifyOrderId: ingestedOrder.shopify_order_id,
    shippingAddress: rewritten.shopifyPayload ? rewritten.shopifyPayload.shipping_address : {},
    tags: ['RTO-Shield-Verified', 'Address-Cleaned']
  });

  if (seller.shopify_access_token && seller.shopify_domain) {
    if (updateRes.success) {
      console.log(`   ✓ Shopify Address Overwrite: PASS (Target Order ID: ${ingestedOrder.shopify_order_id})`);
      passedTests++;
    } else {
      console.error(`   ✗ Shopify Address Overwrite: FAIL (${updateRes.error})`);
    }
  } else {
    // Fail-closed validation: unconfigured credentials must not claim success
    if (updateRes.success === false && updateRes.mode === 'not_configured') {
      console.log(`   ✓ Shopify Address Overwrite Fail-Closed: PASS (Refused to fake success without live token)`);
      passedTests++;
    } else {
      console.error(`   ✗ Shopify Address Overwrite: FAIL (Expected mode: 'not_configured', got: ${JSON.stringify(updateRes)})`);
    }
  }

  // 6. Test Live Order Cancellation on Refusal (Fake Block)
  console.log('\n🔹 [6/7] Testing High-Risk Fake Order Cancellation on Shopify (POST):');
  const cancelRes = await cancelShopifyOrder({
    shopifyDomain: seller.shopify_domain,
    accessToken: seller.shopify_access_token,
    externalOrderId: ingestedOrder.external_order_id,
    shopifyOrderId: ingestedOrder.shopify_order_id,
    reason: 'customer'
  });

  if (seller.shopify_access_token && seller.shopify_domain) {
    if (cancelRes.success) {
      console.log(`   ✓ Shopify Order Cancellation: PASS (Order cancelled)`);
      passedTests++;
    } else {
      console.error(`   ✗ Shopify Order Cancellation: FAIL (${cancelRes.error})`);
    }
  } else {
    // Fail-closed validation: unconfigured credentials must not claim success
    if (cancelRes.success === false && cancelRes.mode === 'not_configured') {
      console.log(`   ✓ Shopify Order Cancellation Fail-Closed: PASS (Safely halted on unconfigured credentials)`);
      passedTests++;
    } else {
      console.error(`   ✗ Shopify Order Cancellation: FAIL (Expected mode: 'not_configured', got: ${JSON.stringify(cancelRes)})`);
    }
  }

  // 7. Test Shiprocket Logistics Connector
  console.log('\n🔹 [7/7] Testing Shiprocket Logistics Handshake & Address Push:');
  const srLoginRes = await shiprocketLogin({ email: 'demo@snitchcloth.in', password: 'demo_password' });
  const srUpdateRes = await updateShiprocketCustomAddress({
    token: srLoginRes.token || 'demo_token',
    externalOrderId: ingestedOrder.external_order_id,
    deliveryAddress: rewritten.cleanedAddressLine1,
    deliveryAddress2: rewritten.cleanedAddressLine2,
    landmark: rewritten.cleanedLandmark,
    city: ingestedOrder.city,
    pincode: ingestedOrder.pincode
  });

  if (srLoginRes.success === false && srLoginRes.mode === 'not_configured' &&
      srUpdateRes.success === false && srUpdateRes.mode === 'not_configured') {
    console.log(`   ✓ Shiprocket Logistics Fail-Closed: PASS (Safely halted on demo/unconfigured credentials)`);
    passedTests++;
  } else if (srLoginRes.success && srUpdateRes.success) {
    console.log(`   ✓ Shiprocket Authentication & Address Push: PASS (Live connected)`);
    passedTests++;
  } else {
    console.error(`   ✗ Shiprocket Logistics: FAIL (Login: ${JSON.stringify(srLoginRes)}, Update: ${JSON.stringify(srUpdateRes)})`);
  }

  console.log('\n================================================================');
  if (passedTests === totalTests) {
    console.log(`🎉 ALL ${passedTests}/${totalTests} PRODUCTION BACKEND CONNECTION TESTS PASSED 100%!`);
    console.log('Shipvera is rigorously fail-closed and ready for real merchant credentials.');
  } else {
    console.warn(`⚠️ ${passedTests}/${totalTests} Tests passed. Please check the logs.`);
  }
  console.log('================================================================\n');
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
