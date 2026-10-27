/**
 * Feature 5: "Quick-Paste" Mode for Instagram & WhatsApp Sellers
 * Extracts unstructured chat messages into validated order entities.
 */

const { sanitizeAddress } = require('./geoSanitizer');

/**
 * Parses unstructured WhatsApp/Instagram buyer chat messages
 */
function parseQuickPaste(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Raw text input is required');
  }

  const text = rawText.trim();

  // 1. Extract 10-digit Indian Mobile Number
  const phoneMatch = text.match(/(?:\+91[\-\s]?)?[6789]\d{9}\b/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, '') : '';

  // 2. Extract COD Amount (e.g. "COD 799", "₹799", "amount 1299", "rs 850")
  let codAmount = 0;
  const amountMatch = text.match(/(?:cod|rs\.?|inr|₹|amount|total)[\s:]*([0-9]{2,6})/i) || text.match(/\b([0-9]{3,5})\s*(?:cod|rs|\/-)/i);
  if (amountMatch) {
    codAmount = Number(amountMatch[1]);
  } else {
    // Try to find any standalone 3-4 digit number that isn't a pincode or phone
    const numbers = text.match(/\b[1-9]\d{2,3}\b/g) || [];
    const validAmount = numbers.find(n => Number(n) >= 199 && Number(n) <= 25000);
    if (validAmount) codAmount = Number(validAmount);
  }

  // 3. Extract 6-digit Indian Pincode
  const pinMatch = text.match(/\b[1-9][0-9]{5}\b/);
  const pincode = pinMatch ? pinMatch[0] : '';

  // 4. Extract Indian Cities (heuristic match)
  const commonCities = [
    'delhi', 'mumbai', 'bangalore', 'bengaluru', 'hyderabad', 'chennai', 'kolkata',
    'pune', 'ahmedabad', 'jaipur', 'surat', 'lucknow', 'kanpur', 'nagpur', 'indore',
    'thane', 'bhopal', 'visakhapatnam', 'patna', 'vadodara', 'ghaziabad', 'ludhiana',
    'agra', 'nashik', 'faridabad', 'meerut', 'rajkot', 'varanasi', 'srinagar',
    'aurangabad', 'dhanbad', 'amritsar', 'navi mumbai', 'allahabad', 'prayagraj',
    'ranchi', 'howrah', 'coimbatore', 'jabalpur', 'gwalior', 'vijayawada', 'jodhpur',
    'madurai', 'raipur', 'kota', 'chandigarh', 'guwahati', 'solapur', 'hubli',
    'mysore', 'tiruchirappalli', 'bareilly', 'aligarh', 'tiruppur', 'gurgaon', 'gurugram',
    'moradabad', 'jalandhar', 'bhubaneswar', 'salem', 'warangal', 'mira-bhayandar',
    'jalgaon', 'guntur', 'thiruvananthapuram', 'bhiwandi', 'saharanpur', 'noida',
    'dehradun', 'rohtak', 'panipat', 'karnal', 'sonipat'
  ];

  let detectedCity = '';
  const textLower = text.toLowerCase();
  for (const city of commonCities) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(textLower)) {
      detectedCity = city.charAt(0).toUpperCase() + city.slice(1);
      break;
    }
  }

  // 5. Extract Buyer Name (usually first 1-3 words before phone or comma)
  let buyerName = '';
  const nameCandidate = text.split(/[\n,]/)[0].replace(/[0-9+]/g, '').trim();
  if (nameCandidate && nameCandidate.split(/\s+/).length <= 4) {
    buyerName = nameCandidate;
  }

  // 6. Extract Raw Address: Strip phone, amount, name
  let cleanAddress = text
    .replace(phone, '')
    .replace(/(?:cod|rs\.?|inr|₹|amount|total)[\s:]*[0-9]{2,6}/gi, '')
    .trim();

  // If name was at the very start, remove it from address
  if (cleanAddress.toLowerCase().startsWith(buyerName.toLowerCase())) {
    cleanAddress = cleanAddress.slice(buyerName.length).replace(/^[\s,:-]+/, '');
  }

  const rawAddress = cleanAddress.slice(0, 150).trim();

  // 7. Extract Item description if specified
  let itemName = '';
  const itemKeywords = ['hoodie', 'tshirt', 'shirt', 'sneakers', 'shoes', 'jeans', 'watch', 'jacket', 'kurti', 'dress', 'bag'];
  for (const kw of itemKeywords) {
    if (textLower.includes(kw)) {
      const match = text.match(new RegExp(`([a-z0-9\\s]{3,20}${kw}[a-z0-9\\s]{0,10})`, 'i'));
      if (match) itemName = match[1].trim();
      break;
    }
  }

  // 8. Run Geo-Sanitizer check on extracted address
  const sanitation = sanitizeAddress({
    rawAddress,
    city: detectedCity,
    pincode,
    buyerPhone: phone || '',
    buyerName
  });

  return {
    buyerName,
    buyerPhone: phone ? (phone.startsWith('+91') ? phone : `+91${phone}`) : '',
    rawAddress,
    city: detectedCity || '',
    pincode: pincode || '',
    codAmount: codAmount || 0,
    itemName,
    sanitation
  };
}

module.exports = {
  parseQuickPaste
};
