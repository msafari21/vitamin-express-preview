// Local preview state only. No notes, addresses or coordinates are sent to Shopify.
const KEY = 'vitamin-express-shopping-preferences-v1';
const NOTE_KEY = 'vitamin-express-cart-note-v1';
export const currencies = ['CAD', 'USD', 'EUR'];
export const countries = { CA: 'Canada', US: 'United States', FR: 'France', DE: 'Germany', NL: 'Netherlands', IE: 'Ireland', ES: 'Spain', IT: 'Italy', OTHER: 'Other destination' };
let preferences = { currency: 'CAD', destination: null };
let note = '';
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (currencies.includes(saved.currency)) preferences.currency = saved.currency;
  if (saved.destination && validatePostal(saved.destination.country, saved.destination.postal)) {
    preferences.destination = { country: saved.destination.country, postal: normalizePostal(saved.destination.country, saved.destination.postal) };
  }
  note = (localStorage.getItem(NOTE_KEY) || '').slice(0, 500);
} catch { /* Defaults remain usable when storage is unavailable. */ }
export const getPreferences = () => ({ ...preferences, destination: preferences.destination ? { ...preferences.destination } : null });
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); return true; } catch { return false; }
}
export function setCurrency(currency) {
  if (!currencies.includes(currency)) return false;
  preferences.currency = currency;
  persist();
  return true;
}
export function normalizePostal(country, value = '') {
  const text = String(value).trim().toUpperCase().replace(/\s+/g, ' ');
  return country === 'CA' ? text.replace(/\s/g, '').replace(/^(.{3})(.{3})$/, '$1 $2') : text;
}
export function validatePostal(country, value) {
  if (!Object.hasOwn(countries, country)) return false;
  const postal = normalizePostal(country, value);
  if (country === 'CA') return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] \d[ABCEGHJ-NPRSTV-Z]\d$/.test(postal);
  if (country === 'US') return /^\d{5}(?:-\d{4})?$/.test(postal);
  if (['FR', 'DE', 'ES', 'IT'].includes(country)) return /^\d{5}$/.test(postal);
  if (country === 'NL') return /^[1-9]\d{3}\s?[A-Z]{2}$/.test(postal);
  if (country === 'IE') return /^[A-Z0-9]{3}\s?[A-Z0-9]{4}$/.test(postal);
  return /^[A-Z0-9][A-Z0-9 -]{1,11}$/.test(postal);
}
export function setDestination(country, postal) {
  if (!validatePostal(country, postal)) return false;
  preferences.destination = { country, postal: normalizePostal(country, postal) };
  persist();
  return true;
}
export function clearDestination() { preferences.destination = null; persist(); }
export const getOrderNote = () => note;
export function saveOrderNote(value) {
  note = String(value).slice(0, 500);
  try {
    if (note) localStorage.setItem(NOTE_KEY, note); else localStorage.removeItem(NOTE_KEY);
    return true;
  } catch { return false; }
}
export function displayPrice(amount, sourceCurrency, rates, selectedCurrency = preferences.currency) {
  const rate = rates?.[selectedCurrency];
  // Never silently relabel unsupported source currencies or missing exchange rates.
  const converted = sourceCurrency === 'CAD' && selectedCurrency !== 'CAD' && Number.isFinite(rate) && rate > 0;
  return { amount: Number(amount) * (converted ? rate : 1), currency: converted ? selectedCurrency : sourceCurrency, approximate: converted };
}
export function shippingEstimate(subtotalCad, config, destination = preferences.destination) {
  const country = destination?.country || config?.default_country || 'CA';
  const postal = destination?.postal || '';
  const rule = config?.rules?.find(rule => rule.country === country && (!rule.prefixes?.length || (postal && rule.prefixes.some(prefix => postal.startsWith(prefix)))));
  if (!rule || !Number.isFinite(rule.price_cad) || rule.price_cad < 0) return { country, postal, costCad: null, freeOverCad: null, isDefault: !destination };
  const freeOverCad = Number.isFinite(rule.free_over_cad) && rule.free_over_cad > 0 ? rule.free_over_cad : null;
  return { country, postal, costCad: freeOverCad && subtotalCad >= freeOverCad ? 0 : rule.price_cad, freeOverCad, isDefault: !destination };
}

// Optional merchant-owned adapter: POST {latitude,longitude} -> {country,postal}.
// Disabled until configured. No public third-party geocoder or silent IP lookup.
export async function detectDestination(config, { signal } = {}) {
  const endpoint = config?.geocode_endpoint;
  if (!endpoint || !endpoint.startsWith('/') || endpoint.startsWith('//')) throw new Error('Location lookup is not connected yet. Please enter your postal code.');
  if (!navigator.geolocation || !isSecureContext) throw new Error('Location is unavailable. Please enter your postal code.');
  const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude }), signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(8000)]) });
  if (!response.ok) throw new Error('Location is unavailable. Please enter your postal code.');
  const result = await response.json();
  const country = String(result.country || '').toUpperCase();
  if (!validatePostal(country, result.postal)) throw new Error('No postal code was found. Please enter it manually.');
  return { country, postal: normalizePostal(country, result.postal) };
}
