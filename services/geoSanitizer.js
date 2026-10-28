/**
 * Feature 1: Pre-Call "Address Geo-Sanitizer" & Risk Engine
 * PRD Goal: Don't waste ₹2 call cost on clean orders; filter and prepare context before calling.
 */

const { db } = require('../db');

// Common Indian Address Keywords indicating presence of house/premise details
const HOUSE_INDICATORS = [
  'house', 'h.no', 'h no', 'flat', 'plot', 'room', 'kothi', 'banglow', 'bungalow',
  'floor', 'manzil', 'block', 'quarter', 'qtr', 'shop', 'dukan', 'no.', 'no ', '#'
];

// Common Indian Landmark Keywords
const LANDMARK_INDICATORS = [
  'near', 'opp', 'opposite', 'behind', 'piche', 'samne', 'baju', 'pass', 'paas',
  'mandir', 'temple', 'masjid', 'school', 'hospital', 'chowk', 'circle', 'sweets',
  'dairy', 'station', 'metro', 'gate', 'road', 'marg'
];

function isGibberish(str) {
  if (!str) return true;
  const cleaned = str.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length < 5) return false;

  // Repetitive single character (e.g. 'aaaaa', 'xxxxx')
  if (/(.)\1{4,}/.test(cleaned)) return true;

  // Keyboard home row patterns
  const keyboardSmashes = ['asdf', 'qwer', 'zxcv', 'hjkl', 'ghjk', 'dfgh', '123456'];
  for (const smash of keyboardSmashes) {
    if (cleaned.includes(smash)) return true;
  }

  // Low vowel count in long sequence (unnatural consonant cluster)
  const vowels = cleaned.match(/[aeiou]/g);
  if (cleaned.length > 8 && (!vowels || vowels.length / cleaned.length < 0.15)) {
    return true;
  }

  return false;
}

function hasRepeatedDigits(phone) {
  const digitsOnly = String(phone).replace(/\D/g, '').slice(-10);
  if (digitsOnly.length !== 10) return true;
  // All same digit (e.g., 9999999999, 1111111111)
  if (/^(\d)\1{9}$/.test(digitsOnly)) return true;
  // Dummy sequences (e.g., 1234567890, 9876543210 test number)
  if (digitsOnly === '1234567890' || digitsOnly === '0000000000') return true;
  return false;
}

/**
 * Sanitizes and calculates pre-call risk score for a COD order
 */
function sanitizeAddress({ rawAddress, city, pincode, buyerPhone, buyerName }) {
  const flags = [];
  const missingFields = [];
  let riskScore = 20; // Base baseline risk for COD

  const addressLower = (rawAddress || '').toLowerCase().trim();

  // 1. Length check (< 25 chars is high risk in India)
  if (addressLower.length < 25) {
    flags.push('SHORT_ADDRESS_LENGTH');
    missingFields.push('extended_address');
    riskScore += 25;
  }

  // 2. House/Flat number check
  const hasHouse = HOUSE_INDICATORS.some(kw => addressLower.includes(kw)) || /\b\d{1,4}[a-z]?\b/i.test(addressLower);
  if (!hasHouse) {
    flags.push('MISSING_HOUSE_NUMBER');
    missingFields.push('house_number');
    riskScore += 20;
  }

  // 3. Landmark check
  const hasLandmark = LANDMARK_INDICATORS.some(kw => addressLower.includes(kw));
  if (!hasLandmark) {
    flags.push('MISSING_LANDMARK');
    missingFields.push('landmark');
    riskScore += 15;
  }

  // 4. Gibberish check
  if (isGibberish(addressLower)) {
    flags.push('GIBBERISH_ADDRESS_DETECTED');
    riskScore += 40;
  }

  // 5. Phone number validity check
  if (hasRepeatedDigits(buyerPhone)) {
    flags.push('FAKE_PHONE_NUMBER_PATTERN');
    riskScore += 35;
  }

  // 6. Global Buyer Trust Graph lookup
  const trustData = db.getBuyerTrust(buyerPhone);
  if (trustData.global_risk_level === 'habitual_timepasser') {
    flags.push('HISTORIC_REPEAT_FAKE_BUYER');
    riskScore += 40;
  } else if (trustData.global_risk_level === 'trusted') {
    riskScore = Math.max(5, riskScore - 25);
  }

  // Cap risk score between 0 and 100
  riskScore = Math.min(100, Math.max(5, riskScore));

  // Determine if phone interrogation is required
  const needsInterrogation = riskScore >= 35 || missingFields.length > 0;

  // 7. Dynamic Interrogation Prompt Generator for Shipvera AI
  const interrogationFocus = [];
  if (missingFields.includes('house_number')) {
    interrogationFocus.push('makan number ya gate ka rang');
  }
  if (missingFields.includes('landmark')) {
    interrogationFocus.push('aas-pass ki koi mashhoor dukaan, mandir ya school');
  }
  if (interrogationFocus.length === 0) {
    interrogationFocus.push('exact landmark taaki courier boy seedha deliver kar sake');
  }

  const promptGuidance = `Buyer ne address me "${rawAddress || city}" likha hai. Missing details: ${missingFields.join(', ')}. Specially pucho: ${interrogationFocus.join(' aur ')}.`;

  return {
    riskScore,
    flags,
    missingFields,
    needsInterrogation,
    promptGuidance,
    isGibberish: flags.includes('GIBBERISH_ADDRESS_DETECTED')
  };
}

const https = require('https');

/**
 * Validates address deliverability and extracts coordinates using Google Maps Geocoding REST API
 * Compliant with Google Maps Platform guidelines:
 * - Uses Geocoding REST API directly (as google.maps.Geocoder JS class is legacy/deprecated)
 * - Includes required X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1 header
 */
async function geocodeAddressGoogleMaps({ address, city, pincode }) {
  const query = `${address || ''}, ${city || ''} ${pincode || ''}, India`.trim();
  const apiKey = process.env.GOOGLE_MAPS_API_KEY; // No demo key fallback.

  // If no Google Maps key is configured, fail visibly with unknown
  // deliverability. Never return success:true with a pincode centroid
  // and a fixed score when no geocoding actually happened.
  if (!apiKey) {
    return {
      success: false,
      mode: 'not_configured',
      reason: 'GOOGLE_MAPS_API_KEY is not set. No geocoding was performed.',
      coordinates: null,
      locationType: 'UNKNOWN',
      partialMatch: false,
      formattedAddress: query,
      placeId: null,
      deliverabilityScore: null,
      accuracyLabel: 'Unknown - Google Maps not configured',
      riskImpact: 'NEEDS_LANDMARK_VERIFICATION'
    };
  }

  return new Promise((resolve) => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`;
    
    const req = https.get(url, {
      headers: {
        'X-Goog-Maps-Solution-ID': 'gmp_git_agentskills_v1',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'OK' && json.results && json.results.length > 0) {
            const first = json.results[0];
            const locType = first.geometry.location_type; // 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE'
            const isPartial = Boolean(first.partial_match);
            
            let deliverabilityScore = 95;
            let accuracyLabel = 'ROOFTOP PRECISE';
            let riskImpact = 'DELIVERABLE';

            if (locType === 'APPROXIMATE' || isPartial) {
              deliverabilityScore = 55;
              accuracyLabel = 'APPROXIMATE (Missing Premise/Landmark)';
              riskImpact = 'HIGH_RTO_RISK_CALL_REQUIRED';
            } else if (locType === 'GEOMETRIC_CENTER') {
              deliverabilityScore = 75;
              accuracyLabel = 'STREET / SECTOR CENTER';
              riskImpact = 'MODERATE_CONFIRMATION_RECOMMENDED';
            }

            resolve({
              success: true,
              isDemoMode: false,
              coordinates: first.geometry.location, // { lat, lng }
              locationType: locType,
              partialMatch: isPartial,
              formattedAddress: first.formatted_address,
              placeId: first.place_id,
              deliverabilityScore,
              accuracyLabel,
              riskImpact
            });
          } else {
            resolve({
              success: false,
              error: json.status,
              coordinates: null,
              deliverabilityScore: null,
              accuracyLabel: 'UNRESOLVED_BY_MAPS',
              riskImpact: 'SEVERE_RTO_RISK'
            });
          }
        } catch (e) {
          resolve({
            success: false,
            error: e.message,
            coordinates: null,
            deliverabilityScore: null,
            accuracyLabel: 'MAPS_ERROR',
            riskImpact: 'NEEDS_LANDMARK_VERIFICATION'
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        coordinates: null,
        deliverabilityScore: null,
        accuracyLabel: 'MAPS_REQUEST_FAILED',
        riskImpact: 'NEEDS_LANDMARK_VERIFICATION'
      });
    });
  });
}

module.exports = {
  sanitizeAddress,
  geocodeAddressGoogleMaps,
  isGibberish,
  hasRepeatedDigits
};
