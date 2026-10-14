import { getLocale, setLocale, t, localize, searchText, localizedSearchText } from './i18n.js';
import { currencies, countries, getPreferences, setCurrency, setDestination, clearDestination, getOrderNote, saveOrderNote, displayPrice, shippingEstimate, detectDestination } from './shopping-preferences.js';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const dialog = document.querySelector('#info-dialog');
const dialogContent = document.querySelector('#dialog-content');
const CART_KEY = 'vitamin-express-demo-cart-v1';
const SETTINGS_KEY = 'vitamin-express-demo-settings-v1';
const SCROLL_KEY = 'vitamin-express-demo-scroll-v1';
const FLASH_DISMISS_KEY = 'vitamin-express-demo-flash-dismissed-until-v2';
const FLASH_DISMISS_MS = 24 * 60 * 60 * 1000;

let catalog;
let defaults;
let settings;
let previousHash = location.hash || '#/';
let mutationQueue = Promise.resolve();
let autocompleteTimer;
let dialogOpener;
let settingsOpener;
let purchaseObserver;
let megaPinned = false;
let suppressMegaFocusOpen = false;
let cartDrawerOpener;
let zoomOpener;
let chatOpener;
let accountOpener;
let localizationOpener;
let deliveryOpener;
let deliveryReturnToCart = false;
let locationRequest;
let pendingCartDrawer = false;
let heroTimer;
let brandTimer;
let heroTouchStartX = null;
let offerTimer;
let megaHoverTimer;
let comparedHandles = [];
const comparedVariants = new Map();
const MEGA_HOVER_INTENT_MS = 110;

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const slugify = (value = '') => value.toLowerCase().replaceAll('&', 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const presentedPrice = (amount, currency = 'CAD') => displayPrice(amount, currency, settings?.currency_preview?.rates_from_cad);
const money = (amount, currency = 'CAD') => {
  const price = presentedPrice(amount, currency);
  return `${price.approximate ? '≈ ' : ''}${new Intl.NumberFormat(getLocale(), { style: 'currency', currency: price.currency }).format(price.amount)}`;
};
const moneyLabel = (amount, currency = 'CAD') => `${money(amount, currency)} ${presentedPrice(amount, currency).currency}`;
const currencyLabel = () => `${getLocale() === 'fr-CA' ? 'FR' : 'EN'} · ${getPreferences().currency}`;
const destinationLabel = () => {
  const destination = getPreferences().destination;
  return destination ? `${t(countries[destination.country])} · ${destination.postal}` : t('Set delivery location');
};
const currencyDisclaimer = () => getPreferences().currency === 'CAD' ? '' : '<p class="currency-estimate-note">Approximate prices · demo exchange rates. Final currency and amount confirmed at checkout.</p>';
const truncate = (value, size = 170) => value.length > size ? `${value.slice(0, size).trim()}…` : value;
const canadaFlag = () => '<span class="canada-flag" aria-hidden="true"><svg viewBox="0 0 30 20" focusable="false"><path fill="#d52b1e" d="M0 0h6v20H0zM24 0h6v20h-6zM15 3l1.15 3.15 2.85-1.1-.75 3.05 3 .15-2.35 2.05 1.7 1.35-4.45 1.05.25 4.3h-2.8l.25-4.3-4.45-1.05 1.7-1.35-2.35-2.05 3-.15-.75-3.05 2.85 1.1z"/></svg></span>';
const productImage = (product, size = 'card') => size === 'full' ? `/vitamin-express-preview/catalog/${product.media[0].local_path}` : `/vitamin-express-preview/catalog/derived/640/${product.handle}.webp`;
const findProduct = (handle) => catalog.products.find((product) => product.handle === handle);

function moneyMinor(value) {
  const match = String(value ?? '').trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}

function priceState(variant) {
  const priceMinor = moneyMinor(variant?.price?.amount);
  const compareMinor = moneyMinor(variant?.compare_at_price?.amount);
  const currency = variant?.price?.currency || 'CAD';
  const comparable = priceMinor !== null && compareMinor !== null && compareMinor > 0 && compareMinor > priceMinor && variant?.compare_at_price?.currency === currency;
  const savingMinor = comparable ? compareMinor - priceMinor : 0;
  const savingPercent = comparable ? Math.floor((savingMinor * 100) / compareMinor) : 0;
  return { priceMinor, compareMinor, currency, onSale: comparable, savingMinor, savingPercent };
}

function priceMarkup(variant, { compact = false } = {}) {
  const state = priceState(variant);
  const current = moneyLabel((state.priceMinor || 0) / 100, state.currency);
  if (!state.onSale) return `<span class="price-group${compact ? ' compact' : ''}"><span class="current-price" aria-label="Current price ${escapeHtml(current)}">${escapeHtml(current)}</span></span>`;
  const reference = moneyLabel(state.compareMinor / 100, state.currency);
  const saving = state.savingPercent > 0 ? `Save ${state.savingPercent}%` : `Save ${moneyLabel(state.savingMinor / 100, state.currency)}`;
  return `<span class="price-group is-sale${compact ? ' compact' : ''}"><span class="current-price" aria-label="Current price ${escapeHtml(current)}">${escapeHtml(current)}</span><s class="reference-price" aria-label="Reference price ${escapeHtml(reference)}">${escapeHtml(reference)}</s><span class="saving" aria-label="${escapeHtml(saving)}">${escapeHtml(saving)}</span></span>`;
}

function productPriceMarkup(product, preferredVariant = null) {
  if (preferredVariant) return priceMarkup(preferredVariant, { compact: true });
  const eligible = product.variants.filter((variant) => variant.available_snapshot);
  const variants = eligible.length ? eligible : product.variants;
  const amounts = variants.map((variant) => moneyMinor(variant.price.amount)).filter((value) => value !== null);
  const currency = variants[0]?.price?.currency || product.price_range.currency || 'CAD';
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (variants.length > 1 && min !== max) {
    const label = `${moneyLabel(min / 100, currency)}–${moneyLabel(max / 100, currency)}`;
    return `<span class="price-group compact"><span class="current-price" aria-label="Available variant price range ${escapeHtml(label)}">${escapeHtml(label)}</span><small>Choose an exact option</small></span>`;
  }
  return priceMarkup(variants[0], { compact: true });
}

function productHref(product, variantId = '') {
  const query = variantId ? `?variant=${encodeURIComponent(variantId)}` : '';
  return `#/product/${encodeURIComponent(product.handle)}${query}`;
}

function variantFromSearch(product, query) {
  const normalized = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized || product.variants.length < 2) return null;
  return product.variants.find((variant) => normalized.split(' ').some((term) => term.length >= 3 && variant.title.toLowerCase().includes(term))) || null;
}

function icon(name) {
  const paths = {
    location: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    chevron: '<path d="m5 9 7 7 7-7"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6"/>',
    bag: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
    cart: '<path d="M3 4h2l2.1 9.7a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H6"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4.8l-.3 3.1a8 8 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.8 1l.3 3.1h4.8l.3-3.1a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chat: '<path d="M5 5h14v10H9l-4 4V5Z"/><path d="M8 9h8M8 12h5"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5M8 10.5h5M10.5 8v5"/>',
    instagram: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.2"/><path d="M17.5 6.5h.01"/>',
    linkedin: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 10v6M8 8v.01M11.5 16v-3.4c0-1.5 2.7-2.2 3.8-.7.4.5.4 1.2.4 2V16M11.5 10v6"/>',
    mail: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>',
    check: '<path d="m6 12 4 4 8-9"/>',
    shield: '<path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    order: '<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    heart: '<path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z"/>',
    mobile: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10 5h4M11 18.5h2"/>',
    truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}
function saveCart(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function cartCount() { return getCart().reduce((total, line) => total + line.quantity, 0); }
function cartBadge() {
  const count = cartCount();
  return `<span class="cart-count${count ? '' : ' is-empty'}" aria-hidden="true">${count > 99 ? '99+' : count}</span><span class="sr-only">${count ? `${count} item${count === 1 ? '' : 's'} in cart` : 'Cart is empty'}</span>`;
}
function cartDetails() {
  return getCart().map((line) => {
    const product = findProduct(line.handle);
    const variant = product?.variants.find((item) => item.source_id === line.variantId);
    return product && variant ? { ...line, product, variant } : null;
  }).filter(Boolean);
}

function cartShippingProgress(subtotalMinor, currency = 'CAD') {
  const preview = settings.cart_shipping_preview || {};
  const estimate = shippingEstimate(subtotalMinor / 100, settings.delivery_preview);
  const targetMinor = Math.round(Number(estimate.freeOverCad) * 100);
  if (!preview.enabled || !Number.isFinite(targetMinor) || targetMinor <= 0) return '';
  const remainingMinor = Math.max(0, targetMinor - subtotalMinor);
  const progress = Math.min(100, Math.round((subtotalMinor / targetMinor) * 100));
  const reached = remainingMinor === 0;
  const message = reached
    ? 'Free shipping in this estimate'
    : `Add ${moneyLabel(remainingMinor / 100, currency)} more for free shipping`;
  return `<section class="cart-shipping-progress${reached ? ' is-reached' : ''}" aria-labelledby="cart-shipping-title">
    <div class="cart-shipping-progress__head"><span class="cart-shipping-progress__icon">${icon(reached ? 'check' : 'truck')}</span><strong id="cart-shipping-title">${escapeHtml(message)}</strong><b>${progress}%</b></div>
    <div class="cart-shipping-progress__track" role="progressbar" aria-label="Progress toward free shipping" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="--shipping-progress:${progress}%"></span></div>
  </section>`;
}

function parseRoute() {
  const raw = (location.hash || '#/').slice(1);
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

function flashSaleDismissed() {
  try {
    const dismissedUntil = Number(localStorage.getItem(FLASH_DISMISS_KEY));
    if (Number.isFinite(dismissedUntil) && dismissedUntil > Date.now()) return true;
    localStorage.removeItem(FLASH_DISMISS_KEY);
  } catch { /* The banner remains available when browser storage is blocked. */ }
  return false;
}

function showToast(message, kind = 'success') {
  toast.textContent = t(message);
  toast.dataset.kind = kind;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function showInfo(title, body, action = '') {
  closeOtherDialogs(dialog);
  document.body.classList.remove('drawer-open');
  dialogOpener = document.activeElement;
  dialogContent.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${action}<button class="button secondary" type="button" data-close-dialog>Close</button>`;
  const mobileMenu = dialogContent.querySelector('.mobile-menu-panel');
  dialog.classList.toggle('mobile-navigation-dialog', Boolean(mobileMenu));
  if (mobileMenu) {
    const close = dialogContent.querySelector('[data-close-dialog]');
    close.className = 'icon-button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = icon('close');
    const header = document.createElement('header');
    header.className = 'mobile-menu-heading';
    header.append(dialogContent.querySelector('h2'), close);
    dialogContent.prepend(header);
  }
  localize(dialogContent);
  dialog.showModal();
  dialog.querySelector('[data-close-dialog]')?.focus();
}

function cleanMenuLabel(value = '') {
  return value.replace(/^Supplements\s*-\s*/i, '').replace(/^Vitamins\s*-\s*/i, '').replace(/^Minerals\s*-\s*/i, '').trim();
}

function brandHighlights(products, limit = 5) {
  const groups = Object.entries(Object.groupBy(products, (product) => product.vendor))
    .sort(([, a], [, b]) => b.length - a.length || a[0]?.vendor.localeCompare(b[0]?.vendor))
    .slice(0, limit);
  return groups.map(([brand, items]) => {
    const product = items.find((item) => item.available_snapshot) || items[0];
    return `<a class="mega-brand" href="#/brand/${slugify(brand)}"><span><strong>${escapeHtml(brand)}</strong><small>${items.length} product${items.length === 1 ? '' : 's'}</small></span><img src="${productImage(product)}" width="72" height="72" alt="" loading="lazy"></a>`;
  }).join('');
}

function megaPanelMarkup({ key, family = '', heading }) {
  const products = family ? catalog.products.filter((product) => product.family === family) : catalog.products;
  const types = [...new Set(products.map((product) => product.product_type).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, family ? 10 : 8);
  const families = [...new Set(catalog.products.map((product) => product.family))];
  const categoryLinks = (family ? families.filter((item) => item !== family).slice(0, 5) : families)
    .map((item) => `<a href="#/collection/${slugify(item)}">${escapeHtml(item)}</a>`).join('');
  const typeLinks = types.map((type) => `<a href="#/search?q=${encodeURIComponent(type)}${family ? `&scope=${encodeURIComponent(family)}` : ''}">${escapeHtml(cleanMenuLabel(type))}</a>`).join('');
  const shelfLink = family ? `#/collection/${slugify(family)}` : '#/categories';
  return `<div class="mega-menu__panel" data-mega-panel="${escapeHtml(key)}" ${key === 'all' ? '' : 'hidden'}>
    <div class="mega-menu__catalog">
      <div><p class="mega-menu__label">${family ? 'Shop this department' : 'Shop departments'}</p><a class="mega-menu__lead" href="${shelfLink}">${escapeHtml(heading)} <span aria-hidden="true">→</span></a>${categoryLinks}</div>
      <div><p class="mega-menu__label">${family ? 'Product types' : 'Find your shelf'}</p>${typeLinks || '<a href="#/categories">Browse all categories</a>'}</div>
      <div><p class="mega-menu__label">Explore more</p>${family ? `<a href="#/brands">Brands A–Z</a><a href="#/journal">Wellness guides</a><a href="#/search?scope=${encodeURIComponent(family)}">Search this department</a>` : '<a href="#/collection/everyday-wellness">Everyday wellness</a><a href="#/brands">Brands A–Z</a><a href="#/journal">Wellness guides</a>'}</div>
    </div>
    <aside class="mega-menu__brands" aria-label="Brand highlights"><div class="mega-menu__brands-head"><p class="mega-menu__label">Brand highlights</p><a href="#/brands">A–Z</a></div><div class="mega-brand-list">${brandHighlights(products)}</div></aside>
  </div>`;
}

function header() {
  const families = [...new Set(catalog.products.map((product) => product.family))].sort();
  const currentScope = parseRoute().params.get('scope') || '';
  const menuDefinitions = [
    { key: 'all', label: 'Shop all', heading: 'All categories', href: '#/categories' },
    { key: 'vitamins', label: 'Vitamins', heading: 'Vitamins', family: 'Vitamins', href: '#/collection/vitamins' },
    { key: 'minerals', label: 'Minerals', heading: 'Minerals', family: 'Minerals', href: '#/collection/minerals' },
    { key: 'digestive', label: 'Digestive wellness', heading: 'Digestive & gut health', family: 'Digestive & Gut Health', href: '#/collection/digestive-and-gut-health' },
    { key: 'sports', label: 'Sports', heading: 'Sports nutrition', family: 'Sports Nutrition', href: '#/collection/sports-nutrition' },
    { key: 'personal-care', label: 'Personal care', heading: 'Beauty & personal care', family: 'Beauty & Personal Care', href: '#/collection/beauty-and-personal-care' },
  ];
  return `
    <div class="utility-strip"><div class="utility-strip__inner"><div class="utility-benefits" aria-label="Store information"><a class="canadian-owned-chip" href="#/canadian-owned">${canadaFlag()}<span>Shop Canadian owned</span></a>${settings.utility_benefits.filter((item) => item.enabled).map((item) => { const content = `${icon(item.icon || 'check')}<span>${escapeHtml(item.label)}${item.conditions ? `<small>${escapeHtml(item.conditions)}</small>` : ''}</span>`; return item.href ? `<a href="${escapeHtml(item.href)}">${content}</a>` : `<span>${content}</span>`; }).join('')}</div><nav aria-label="Store utilities"><a href="#/support">Help & policies</a><div class="language-switch" role="group" aria-label="Store language"><button type="button" data-language="en-CA" lang="en-CA" aria-label="English (Canada)" aria-pressed="${getLocale() === 'en-CA'}">EN</button><span aria-hidden="true">/</span><button type="button" data-language="fr-CA" lang="fr-CA" aria-label="Français (Canada)" aria-pressed="${getLocale() === 'fr-CA'}">FR</button></div><button type="button" data-open-localization aria-haspopup="dialog" aria-controls="localization-preview" aria-expanded="false">${currencyLabel()} ${icon('chevron')}</button></nav></div></div>
    <header class="site-header" data-site-header>
      <div class="header-main">
        <button class="icon-button mobile-only mobile-menu-trigger" type="button" data-mobile-menu aria-label="Open menu" aria-haspopup="dialog" aria-controls="info-dialog">${icon('menu')}</button>
        <a class="brand-lockup" href="#/" aria-label="Vitamin Express home"><img src="/vitamin-express-preview/shared/assets/vitamin-express-wordmark-color.avif" width="600" height="129" alt="Vitamin Express" decoding="async"></a>
        <form class="search-box" data-search-form role="search">
          <label class="sr-only" for="search-scope">Search category</label>
          <select id="search-scope" name="scope" aria-label="Search category"><option value="">All categories</option>${families.map((family) => `<option value="${escapeHtml(family)}" ${currentScope === family ? 'selected' : ''}>${escapeHtml(family)}</option>`).join('')}</select>
          <label class="sr-only" for="site-search">Search products and brands</label>
          <input id="site-search" name="q" type="search" placeholder="Search products, brands or ingredients" autocomplete="off" aria-autocomplete="list" aria-controls="search-suggestions" aria-expanded="false" value="${escapeHtml(parseRoute().params.get('q') || '')}">
          <button type="submit">Search</button>
          <div class="search-suggestions" id="search-suggestions" role="listbox" aria-label="Product suggestions" hidden></div>
        </form>
        <div class="header-actions" aria-label="Account and cart">
          <button class="header-action account-trigger" type="button" data-open-account aria-haspopup="dialog" aria-controls="account-preview" aria-label="Open account options" title="Account">${icon('user')}<span class="sr-only">Account</span></button>
          <button class="header-action cart-trigger" type="button" data-cart-trigger aria-haspopup="dialog" aria-controls="cart-drawer" aria-label="Open cart, ${cartCount()} ${cartCount() === 1 ? 'item' : 'items'}" title="Cart"><span class="cart-icon-wrap">${icon('cart')}${cartBadge()}</span><span class="sr-only">Cart</span></button>
        </div>
      </div>
      <div class="nav-row">
        <div class="nav-inner">
          <nav class="primary-nav" aria-label="Main navigation">
            ${menuDefinitions.map((item) => `<span class="nav-menu-item" data-mega-hover><a class="nav-menu-link" href="${escapeHtml(item.href)}" data-mega-link data-mega-key="${escapeHtml(item.key)}">${escapeHtml(item.label)}</a><button class="nav-trigger" type="button" data-mega-trigger data-mega-key="${escapeHtml(item.key)}" aria-label="Open ${escapeHtml(item.label)} menu" aria-expanded="false" aria-controls="mega-menu">${icon('chevron')}</button></span>`).join('')}
            <a href="#/brands">Brands A–Z</a><a href="#/journal">Wellness guides</a>
          </nav>
          <button class="nav-note delivery-trigger" type="button" data-open-delivery aria-haspopup="dialog" aria-controls="delivery-preview">${icon('location')}<span>${escapeHtml(destinationLabel())}</span></button>
        </div>
      </div>
      <div class="mega-menu" id="mega-menu" data-mega-menu hidden>
        <div class="mega-menu__inner">
          ${menuDefinitions.map(megaPanelMarkup).join('')}
        </div>
      </div>
    </header>`;
}

function footer() {
  return `<footer class="site-footer">
    <div class="footer-intro">
      <div class="footer-brand"><a class="brand-lockup" href="#/" aria-label="Vitamin Express home"><img src="/vitamin-express-preview/shared/assets/vitamin-express-wordmark-color.avif" width="600" height="129" alt="Vitamin Express" loading="lazy" decoding="async"></a><p>Vitamins, supplements and everyday wellness essentials—clearly organized for confident shopping.</p></div><div class="footer-preferences"><span class="footer-kicker">Your shopping preferences</span><button class="footer-localization" type="button" data-open-localization aria-haspopup="dialog" aria-expanded="false" aria-controls="localization-preview"><span>${currencyLabel()}</span>${icon('chevron')}</button><button class="footer-delivery" type="button" data-open-delivery aria-haspopup="dialog" aria-controls="delivery-preview">${icon('location')}<span>${escapeHtml(destinationLabel())}</span>${icon('chevron')}</button><small>Language, currency and delivery — your choice.</small></div>
    </div>
    <div class="footer-grid">
      <div><h3>Customer service</h3><a href="#/support">Shipping & delivery</a><a href="#/support">Returns</a><a href="#/support">Contact us</a><a href="#/policies">Policies</a></div>
      <div><h3>My account</h3><a href="#/sign-in">Sign in</a><a href="#/account">Account overview</a><a href="#/account?saved=1">Saved items</a><a href="#/cart">Cart</a></div>
      <div><h3>Company</h3><a href="#/about">About Vitamin Express</a><a href="#/policies?section=terms">Terms & conditions</a><a href="#/policies?section=privacy">Privacy</a><a href="#/policies?section=accessibility">Accessibility</a></div>
      <div><h3>Resources</h3><a href="#/journal">Wellness reading</a><a href="#/article/how-to-read-a-supplement-label">Read a supplement label</a><a href="#/brands">Brands A–Z</a><a href="#/categories">All categories</a></div>
      <div><h3>Ways to shop</h3><a href="#/collection/vitamins">Vitamins</a><a href="#/collection/minerals">Minerals</a><a href="#/collection/digestive-and-gut-health">Digestive wellness</a><a href="#/collection/beauty-and-personal-care">Personal care</a></div>
      <div><h3>Need help?</h3><a href="#/support">Customer support</a><a href="#/support">Help centre</a><a href="#/journal">Wellness guides</a></div>
    </div>
    <div class="footer-meta"><span>© ${new Date().getFullYear()} Vitamin Express. All rights reserved.</span><span>${getPreferences().currency === 'CAD' ? t('Canada · Prices shown in CAD.') : t('Approximate prices · demo exchange rates.')}</span></div>
  </footer>`;
}

function accountPreviewMarkup() {
  return `<dialog class="account-dialog" id="account-preview" aria-labelledby="account-preview-title"><div class="account-panel"><header><div><p class="eyebrow">Welcome to Vitamin Express</p><h2 id="account-preview-title">My account</h2></div><button class="icon-button" type="button" data-close-account aria-label="Close account options">${icon('close')}</button></header><div class="account-popover-grid"><section class="account-status"><span class="status-pill">Guest</span><h3>Your shopping tools, in one place.</h3><p>Sign in to revisit orders, save favourites and make repeat shopping easier.</p><a class="account-canadian-owned" href="#/canadian-owned">${canadaFlag()}<span><strong>Shop Canadian owned</strong><small>Discover Canadian wellness brands</small></span><span aria-hidden="true">→</span></a><div class="account-benefit-list"><div>${icon('order')}<span><strong>Orders and reorder</strong><small>Find previous purchases and reorder essentials.</small></span></div><div>${icon('heart')}<span><strong>Saved items</strong><small>Keep favourites together for later.</small></span></div><div>${icon('shield')}<span><strong>Secure access</strong><small>Your account sign-in is protected by Shopify.</small></span></div></div></section><section class="account-shortcuts"><h3>Account shortcuts</h3><nav aria-label="Account options"><a href="#/account">Account overview <span aria-hidden="true">→</span></a><a href="#/account?orders=1">Orders <span aria-hidden="true">→</span></a><a href="#/account?saved=1">Saved items <span aria-hidden="true">→</span></a><a href="#/support">Customer support <span aria-hidden="true">→</span></a></nav></section></div><div class="account-actions"><a class="button" href="#/sign-in">Sign in</a><button class="button secondary" type="button" data-demo-signin data-provider="Create account">Create account</button></div></div></dialog>`;
}

function localizationPreviewMarkup() {
  const labels = { CAD: 'CAD — Canadian Dollar', USD: 'USD — US Dollar', EUR: 'EUR — Euro' };
  return `<dialog class="localization-dialog" id="localization-preview" aria-labelledby="localization-title"><form method="dialog" class="localization-panel"><header><div><p class="eyebrow">Make it yours</p><h2 id="localization-title">Language & currency</h2></div><button class="icon-button" value="cancel" aria-label="Close site preferences">${icon('close')}</button></header><p>Choose how you browse. Your delivery destination is set separately.</p><label>Store language<select name="locale"><option value="en-CA" lang="en-CA" ${getLocale() === 'en-CA' ? 'selected' : ''}>English (Canada)</option><option value="fr-CA" lang="fr-CA" ${getLocale() === 'fr-CA' ? 'selected' : ''}>Français (Canada)</option></select></label><label>Currency<select name="currency">${currencies.map(code => `<option value="${code}" ${getPreferences().currency === code ? 'selected' : ''}>${labels[code]}</option>`).join('')}</select></label><p class="preference-disclaimer">CAD is the catalog currency. USD and EUR use sample conversion rates for this demo, not live rates. Final pricing requires Shopify Markets.</p><button class="button" type="button" data-apply-localization>Apply preferences</button></form></dialog>`;
}

function deliveryDialogMarkup() {
  const destination = getPreferences().destination;
  return `<dialog class="delivery-dialog localization-dialog" id="delivery-preview" aria-labelledby="delivery-title"><form class="localization-panel" data-delivery-form novalidate><header><div><p class="eyebrow">A more useful shopping experience</p><h2 id="delivery-title">Where are we delivering?</h2></div><button class="icon-button" type="button" data-close-delivery aria-label="Close delivery preferences">${icon('close')}</button></header><p>Enter a postal code for a shipping estimate. You can change it any time.</p><label>Country<select name="country">${Object.entries(countries).map(([code, name]) => `<option value="${code}" ${code === (destination?.country || 'CA') ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>Postal / ZIP code<input name="postal" autocomplete="postal-code" maxlength="12" value="${escapeHtml(destination?.postal || '')}" placeholder="e.g. M5V 2T6" aria-describedby="delivery-status" required></label><p class="delivery-status" id="delivery-status" role="status" aria-live="polite"></p><button class="button" type="submit">Save delivery location</button><div class="delivery-secondary"><button type="button" class="text-button" data-detect-location>${icon('location')} Use my location</button><button type="button" class="text-button" data-clear-destination>Use Canada default</button></div><p class="preference-disclaimer">Location is optional and requires your permission. Only the confirmed country and postal code are saved in this browser; precise coordinates are not stored.</p>${settings.delivery_preview?.geocode_endpoint ? '<p class="preference-disclaimer">Location is sent to the store’s configured lookup service only after you choose “Use my location”. Confirm the result before saving.</p>' : '<p class="preference-disclaimer">Automatic lookup is not connected in this demo. Manual entry works now.</p>'}<p class="preference-disclaimer">Demo shipping estimates only. Address eligibility, taxes, duties and final rates are confirmed at checkout.</p></form></dialog>`;
}

function shippingSummary(subtotalMinor) {
  const estimate = shippingEstimate(subtotalMinor / 100, settings.delivery_preview);
  return `<div class="delivery-summary"><button type="button" data-open-delivery aria-haspopup="dialog" aria-controls="delivery-preview">${icon('location')}<span>${escapeHtml(destinationLabel())}</span>${icon('chevron')}</button><div><span>Shipping estimate</span><strong>${estimate.costCad === null ? t('At checkout') : moneyLabel(estimate.costCad)}</strong></div><small>${estimate.isDefault ? 'Canada default · sample rate' : 'Sample rate · not a carrier quote'}</small></div>`;
}

function orderNoteMarkup(id) {
  const note = getOrderNote();
  return `<details class="order-note"><summary>${icon('order')}<span>Order instructions</span><span class="note-indicator" data-note-indicator>${note ? 'Added' : 'Optional'}</span>${icon('chevron')}</summary><div><label for="${id}">Packing or delivery requests</label><textarea id="${id}" data-order-note rows="3" maxlength="500" placeholder="e.g. Please avoid extra packaging." aria-describedby="${id}-help ${id}-status">${escapeHtml(note)}</textarea><p id="${id}-help">Do not include payment details or medical information. Requests are not guaranteed.</p><p class="note-status" id="${id}-status" data-note-status role="status">${note ? 'Saved in this browser only · not sent to our team yet.' : 'Local preview · your note will not reach our team until order integration is connected.'}</p><button type="button" class="text-button" data-clear-note>Clear instructions</button></div></details>`;
}

function cartDrawerMarkup() {
  const lines = cartDetails();
  const count = cartCount();
  const subtotalMinor = lines.reduce((total, line) => total + (moneyMinor(line.variant.price.amount) || 0) * line.quantity, 0);
  const savingsMinor = lines.reduce((total, line) => total + priceState(line.variant).savingMinor * line.quantity, 0);
  return `<dialog class="cart-drawer-dialog" id="cart-drawer" aria-labelledby="cart-drawer-title"><div class="cart-drawer-panel">
    <header class="cart-drawer-head"><h2 id="cart-drawer-title">Your cart <span>(${count})</span></h2><button class="icon-button" type="button" data-close-cart aria-label="Close cart">${icon('close')}</button></header>
    <div class="cart-drawer-body">${lines.length ? lines.map((line) => `<article class="cart-drawer-line"><img src="${productImage(line.product)}" width="96" height="96" alt=""><div><a class="cart-line-title" href="${productHref(line.product, line.variantId)}">${escapeHtml(line.product.title)}</a><p>${escapeHtml(line.variant.title === 'Default Title' ? line.product.vendor : line.variant.title)}</p>${priceMarkup(line.variant, { compact: true })}<div class="qty" aria-label="Quantity for ${escapeHtml(line.product.title)}"><button type="button" data-qty="-1" data-variant="${escapeHtml(line.variantId)}" aria-label="Decrease quantity">−</button><output>${line.quantity}</output><button type="button" data-qty="1" data-variant="${escapeHtml(line.variantId)}" aria-label="Increase quantity">+</button></div><button class="remove-link" type="button" data-remove-line="${escapeHtml(line.variantId)}">Remove</button></div><strong class="line-total">${moneyLabel(((moneyMinor(line.variant.price.amount) || 0) * line.quantity) / 100, line.variant.price.currency)}</strong></article>`).join('') : '<div class="cart-drawer-empty"><h3>Your cart is empty</h3><p>Explore our vitamins, supplements and everyday wellness essentials.</p><a class="button" href="#/categories">Start shopping</a></div>'}${lines.length ? orderNoteMarkup('drawer-order-note') : ''}</div>
    <footer class="cart-drawer-summary">${lines.length ? cartShippingProgress(subtotalMinor, lines[0]?.variant.price.currency || 'CAD') : ''}${savingsMinor > 0 ? `<div class="cart-savings"><span>You save</span><strong>${moneyLabel(savingsMinor / 100, lines[0]?.variant.price.currency || 'CAD')}</strong></div>` : ''}<div class="cart-subtotal"><span>Subtotal</span><strong>${moneyLabel(subtotalMinor / 100, lines[0]?.variant.price.currency || 'CAD')}</strong></div>${lines.length ? shippingSummary(subtotalMinor) : ''}${currencyDisclaimer()}<div class="cart-summary-actions"><button class="button" type="button" data-demo-checkout ${lines.length ? '' : 'disabled'}>Checkout</button><a class="cart-summary-link" href="#/cart">View full cart</a></div></footer>
  </div></dialog>`;
}

function chatPreviewMarkup() {
  return `<button class="chat-launcher" type="button" data-open-chat aria-haspopup="dialog" aria-controls="chat-preview">${icon('chat')}<span>Help</span></button><dialog class="chat-dialog" id="chat-preview" aria-labelledby="chat-title"><div class="chat-panel"><header><div><p class="eyebrow">Local preview · not connected</p><h2 id="chat-title">How can we help?</h2></div><button class="icon-button" type="button" data-close-chat aria-label="Close help preview">${icon('close')}</button></header><p>Choose a help path. This preview does not send messages, claim an agent is online, or collect health information.</p><nav aria-label="Help choices"><a href="#/support">Order and delivery guidance</a><a href="#/support">Returns guidance</a><a href="#/journal">Product-label reading guide</a></nav><small>A Shopify-compatible chat provider may be configured later. Installation, hours and activation remain owner-controlled.</small></div></dialog>`;
}

function shell(content) {
  return `${header()}<main id="main-content" class="page-shell" tabindex="-1">${currencyDisclaimer()}${content}</main><div class="demo-controls"><span>Private local presentation</span><button class="button secondary small" type="button" data-open-settings>${icon('gear')} Demo controls</button></div>${footer()}${cartDrawerMarkup()}${accountPreviewMarkup()}${localizationPreviewMarkup()}${deliveryDialogMarkup()}${chatPreviewMarkup()}${settingsDrawer()}`;
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${items.map((item, index) => item.href ? `<a href="${item.href}">${escapeHtml(item.label)}</a><span aria-hidden="true">/</span>` : `<span aria-current="page">${escapeHtml(item.label)}</span>`).join('')}</nav>`;
}

function productCard(product, { query = '', priceRange = null, availableOnly = false, comparison = false } = {}) {
  const matchingVariant = priceRange && product.variants.length > 1 ? product.variants.find((variant) => (!availableOnly || variant.available_snapshot) && matchesPriceRange(variant, priceRange)) : variantFromSearch(product, query);
  const variant = matchingVariant || product.variants.find((item) => item.available_snapshot) || product.variants[0];
  const multi = product.variants.length > 1;
  const href = productHref(product, matchingVariant?.source_id || '');
  const sale = priceState(variant);
  const showSale = sale.onSale && (!multi || Boolean(matchingVariant));
  return `<article class="product-card${showSale ? ' is-sale' : ''}">
    <a class="product-image" href="${href}" aria-label="View ${escapeHtml(product.title)}${matchingVariant ? `, ${escapeHtml(matchingVariant.title)}` : ''}">
      <img src="${productImage(product)}" width="${product.media[0].width || 600}" height="${product.media[0].height || 600}" alt="${escapeHtml(product.media[0].alt)}" loading="lazy">
      ${showSale ? `<span class="sale-flag" aria-label="Save ${sale.savingPercent} percent">−${sale.savingPercent}%</span>` : ''}
      ${product.available_snapshot ? '' : '<span class="availability-badge sold">Sold out</span>'}
    </a>
    <div class="product-info"><a class="product-brand" href="#/brand/${slugify(product.vendor)}">${escapeHtml(product.vendor)}</a>
      <a class="product-title" href="${href}">${escapeHtml(product.title)}</a>
      ${matchingVariant ? `<span class="matched-variant">Matched option: ${escapeHtml(matchingVariant.title)}</span>` : `<span class="product-meta">${escapeHtml(product.family)}</span>`}${productPriceMarkup(product, matchingVariant)}
      <span class="product-stock ${variant.available_snapshot ? 'is-available' : 'is-unavailable'}">${variant.available_snapshot ? 'In stock' : 'Out of stock'}</span>
      ${multi ? `<a class="pack-size-link" href="${href}">${t('Choose pack size')} <span aria-hidden="true">→</span></a>` : ''}
    </div>
    <div class="product-actions">${multi
      ? `<a class="button secondary small" href="${href}">${matchingVariant ? `Review ${escapeHtml(matchingVariant.title)}` : 'Choose options'}</a>`
      : `<button class="button small" type="button" data-add data-handle="${escapeHtml(product.handle)}" data-variant="${escapeHtml(variant.source_id)}" ${variant.available_snapshot ? '' : 'disabled'}>${variant.available_snapshot ? 'Add to cart' : 'Sold out'}</button>`}
    </div>
    ${comparison ? `<label class="compare-choice"><input type="checkbox" data-compare-product="${escapeHtml(product.handle)}" ${comparedHandles.includes(product.handle) ? 'checked' : ''}><span>Compare</span><span class="sr-only"> ${escapeHtml(product.title)}</span></label>` : ''}
  </article>`;
}

function productGrid(products, options = {}) {
  return `<div class="product-grid">${products.map((product) => productCard(product, options)).join('')}</div>`;
}

function comparisonTrayMarkup() {
  if (!comparedHandles.length) return '';
  return `<aside class="comparison-tray" aria-label="Product comparison"><span><strong>${t('Compare products')}</strong><small role="status">${comparedHandles.length} / 3 · ${t('Select 2 or 3 products')}</small></span><div class="comparison-picks">${comparedHandles.map(handle => `<button type="button" data-remove-comparison="${escapeHtml(handle)}" aria-label="${t('Remove')} ${escapeHtml(findProduct(handle).title)}"><img src="${productImage(findProduct(handle))}" width="36" height="36" alt=""><span aria-hidden="true">×</span></button>`).join('')}</div><button class="button small" type="button" data-open-comparison ${comparedHandles.length < 2 ? 'disabled' : ''}>${t('Compare')}</button><button class="icon-button" type="button" data-clear-comparison aria-label="${t('Clear comparison')}">${icon('close')}</button></aside>`;
}

function syncComparison() {
  const tray = document.querySelector('[data-comparison-tray]');
  if (tray) tray.innerHTML = comparisonTrayMarkup();
  document.querySelectorAll('[data-compare-product]').forEach(input => {
    input.checked = comparedHandles.includes(input.dataset.compareProduct);
    input.disabled = comparedHandles.length >= 3 && !input.checked;
  });
  document.body.classList.toggle('has-comparison', Boolean(tray && comparedHandles.length));
}

function comparisonMarkup() {
  const items = comparedHandles.map(findProduct).filter(Boolean).map(product => ({ product, variant: product.variants.find(v => v.source_id === comparedVariants.get(product.handle)) || product.variants.find(v => v.available_snapshot) || product.variants[0] }));
  const row = (label, content) => `<tr><th scope="row">${t(label)}</th>${items.map(item => `<td>${content(item)}</td>`).join('')}</tr>`;
  return `<header class="comparison-heading"><div><p class="eyebrow">${t('A closer look')}</p><h2 id="comparison-title">${t('Compare products')}</h2></div><button class="icon-button" type="button" data-close-comparison aria-label="${t('Close comparison')}">${icon('close')}</button></header><p class="comparison-note">${t('Compare pack details, not medical suitability. Different strengths and serving sizes are not equivalent.')}</p><p class="comparison-scroll-hint">${t('Swipe across to see every product →')}</p><div class="comparison-scroll" tabindex="0" role="region" aria-label="${t('Product comparison')}"><table><caption class="sr-only">${t('Product comparison')}</caption><thead><tr><td></td>${items.map(({product, variant}) => `<th scope="col"><img src="${productImage(product)}" width="100" height="100" alt=""><a href="${productHref(product, variant.source_id)}">${escapeHtml(product.title)}</a></th>`).join('')}</tr></thead><tbody>
    ${row('Brand', ({product}) => escapeHtml(product.vendor))}
    ${row('Pack / option', ({product, variant}) => product.variants.length > 1 ? `<label><span class="sr-only">${t('Choose pack size')} · ${escapeHtml(product.title)}</span><select data-compare-variant="${escapeHtml(product.handle)}">${product.variants.map(v => `<option value="${escapeHtml(v.source_id)}" ${v.source_id === variant.source_id ? 'selected' : ''}>${escapeHtml(v.title)}</option>`).join('')}</select></label>` : escapeHtml(variant.title === 'Default Title' ? product.title : variant.title))}
    ${row('Price', ({variant}) => priceMarkup(variant, {compact:true}))}
    ${row('Price per unit', ({product, variant}) => escapeHtml(unitPriceLabel(product, variant) || t('Not supplied')))}
    ${row('Format', ({product}) => t(productFormat(product) || 'Not supplied'))}
    ${row('Label information', ({product}) => sourceBackedAttributes(product).map(t).join(' · ') || t('Not supplied'))}
    ${row('Availability', ({variant}) => t(variant.available_snapshot ? 'In stock' : 'Out of stock'))}
    ${row('Next step', ({product, variant}) => `<a class="button secondary small" href="${productHref(product, variant.source_id)}">${t('View product')}</a>`)}
  </tbody></table></div>`;
}

function brandsShelf() {
  const brands = [
    ['AOR', 'aor.webp'], ['Natural Factors', 'natural-factors.svg'],
    ['Genestra', 'genestra.png'], ['New Roots', 'new-roots.webp'],
    ['Organic Traditions', 'organic-traditions.svg'], ['New Chapter', 'new-chapter.png'],
    ['Progressive Nutritional', 'progressive.png'], ['Pascoe', 'pascoe.webp'],
  ].filter(([brand]) => catalog.products.some(product => product.vendor === brand));
  return `<section class="section brands-shelf" data-brand-carousel aria-labelledby="brands-shelf-title" aria-roledescription="carousel"><div class="section-head"><div><p class="eyebrow">Find your favourites</p><h2 id="brands-shelf-title">Brands we carry</h2></div><div class="brands-shelf-actions"><a href="#/brands">Explore all brands →</a><div class="rail-actions"><button class="rail-arrow" type="button" data-brand-step="-1" aria-label="Previous brands">←</button><button class="rail-arrow brand-pause" type="button" data-brand-pause aria-label="Pause brand rotation">${icon('pause')}</button><button class="rail-arrow" type="button" data-brand-step="1" aria-label="Next brands">→</button></div></div></div><div class="brands-shelf-grid" tabindex="0" aria-label="Shop by brand">${brands.map(([brand, file]) => `<a href="#/brand/${slugify(brand)}" aria-label="${escapeHtml(brand)}"><img src="/vitamin-express-preview/shared/assets/brand-logos/${file}" width="200" height="80" alt="${escapeHtml(brand)}" loading="lazy" decoding="async"></a>`).join('')}</div></section>`;
}

function setupBrandCarousel() {
  clearInterval(brandTimer);
  const carousel = document.querySelector('[data-brand-carousel]');
  if (!carousel) return;
  const track = carousel.querySelector('.brands-shelf-grid');
  const pause = carousel.querySelector('[data-brand-pause]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  let hovered = false;
  let direction = 1;
  let resumeAfter = 0;
  const updatePause = () => {
    pause.innerHTML = icon(paused ? 'play' : 'pause');
    pause.setAttribute('aria-label', t(paused ? 'Start brand rotation' : 'Pause brand rotation'));
  };
  updatePause();
  const updateArrows = () => {
    carousel.querySelector('[data-brand-step="-1"]').disabled = track.scrollLeft <= 8;
    carousel.querySelector('[data-brand-step="1"]').disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 8;
  };
  track.addEventListener('scroll', updateArrows, {passive:true});
  updateArrows();
  const advance = (step) => {
    const end = track.scrollWidth - track.clientWidth;
    const distance = track.querySelector('a').getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap);
    if (step > 0 && track.scrollLeft >= end - 8) direction = -1;
    else if (step < 0 && track.scrollLeft <= 8) direction = 1;
    else direction = step;
    track.scrollBy({ left: distance * direction, behavior: reduced.matches ? 'instant' : 'smooth' });
  };
  carousel.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') hovered = true; });
  carousel.addEventListener('pointerleave', () => { hovered = false; resumeAfter = Date.now() + 3800; });
  carousel.addEventListener('pointerdown', () => { resumeAfter = Date.now() + 6000; });
  track.addEventListener('wheel', () => { resumeAfter = Date.now() + 6000; }, {passive:true});
  pause.addEventListener('click', () => { paused = !paused; updatePause(); });
  carousel.querySelectorAll('[data-brand-step]').forEach(button => button.addEventListener('click', () => advance(Number(button.dataset.brandStep))));
  brandTimer = setInterval(() => {
    const bounds = carousel.getBoundingClientRect();
    if (paused || hovered || document.hidden || Date.now() < resumeAfter || carousel.contains(document.activeElement) || document.querySelector('dialog[open]') || bounds.bottom <= 0 || bounds.top >= innerHeight) return;
    advance(direction);
  }, 3800);
}

function purchaseReassurance() {
  return `<nav class="purchase-reassurance" aria-label="Shopping information"><button type="button" data-open-delivery>${icon('location')}<span><strong>Delivery estimates</strong><small>Check your postal code</small></span>${icon('chevron')}</button><a href="#/support">${icon('shield')}<span><strong>Returns & support</strong><small>Know before you order</small></span>${icon('chevron')}</a><a href="#/article/how-to-read-a-supplement-label">${icon('order')}<span><strong>Know your product</strong><small>Understand the label</small></span>${icon('chevron')}</a></nav>`;
}

function productRail({ id, eyebrow, title, products, href, feature = null }) {
  return `<section class="section product-rail" aria-labelledby="${id}-title">
    <div class="section-head"><div>${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<h2 id="${id}-title">${escapeHtml(title)}</h2></div><div class="rail-actions"><button class="rail-arrow" type="button" data-rail-button="prev" data-rail-id="${id}" aria-label="Previous products" disabled>←</button><button class="rail-arrow" type="button" data-rail-button="next" data-rail-id="${id}" aria-label="Next products">→</button><a href="${href}">View all</a></div></div>
    <div class="thematic-row">${feature || ''}<div class="product-rail__track" id="${id}" tabindex="0" aria-label="${escapeHtml(title)} products">${products.map(productCard).join('')}</div></div>
  </section>`;
}

function saleProducts() {
  return catalog.products.filter((product) => product.variants.length === 1 && product.variants.some((variant) => variant.available_snapshot && priceState(variant).onSale));
}

function flashSaleBar() {
  const campaign = settings.flash_sale || {};
  if (campaign.enabled === false || flashSaleDismissed()) return '';
  const units = [['days', 'Days'], ['hours', 'Hours'], ['minutes', 'Minutes'], ['seconds', 'Seconds']];
  return `<section class="flash-sale-bar" data-offer-countdown data-end="${escapeHtml(campaign.end_at || '')}" aria-label="Flash sale">
    <div class="flash-sale-bar__inner"><div class="flash-sale-bar__message"><span>${escapeHtml(campaign.badge || 'Flash sale')}</span><strong>${escapeHtml(campaign.heading || 'Limited-time wellness offers')}</strong><small>${escapeHtml(campaign.body || 'Save on selected favourites while offers last.')}</small></div>
    <div class="flash-sale-clock" role="timer" aria-live="off" aria-label="Campaign timing is not scheduled">${units.map(([key, label]) => `<span><b data-countdown-${key}>--</b><small>${label}</small></span>`).join('')}</div>
    <a href="${escapeHtml(campaign.href || '#/deals')}">${escapeHtml(campaign.link_label || 'Browse current offers')} <span aria-hidden="true">→</span></a><button class="flash-sale-close" type="button" data-dismiss-flash aria-label="Close flash sale banner">${icon('close')}</button></div>
  </section>`;
}

function exclusiveDeals(products) {
  const groups = [
    { key: 'all', label: 'All offers', match: () => true },
    { key: 'vitamins-minerals', label: 'Vitamins & minerals', match: (product) => ['Vitamins', 'Minerals'].includes(product.family) },
    { key: 'personal-care', label: 'Personal care', match: (product) => product.family === 'Beauty & Personal Care' },
    { key: 'everyday', label: 'Everyday wellness', match: (product) => product.family === 'Everyday Wellness' },
  ].map((group) => ({ ...group, products: products.filter(group.match).slice(0, 10) })).filter((group) => group.products.length);
  return `<section class="section deals-showcase" aria-labelledby="exclusive-deals-title" data-deals>
    <div class="deals-showcase__header"><div><h2 id="exclusive-deals-title">Online offers</h2><p>Save on selected wellness essentials while current offers last.</p></div><a href="#/deals">View all offers →</a></div>
    <div class="deals-tabs" role="tablist" aria-label="Offer categories">${groups.map((group, index) => `<button type="button" role="tab" id="deal-tab-${group.key}" aria-controls="deal-panel-${group.key}" aria-selected="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}" data-deals-tab="${group.key}">${escapeHtml(group.label)} <span>${group.products.length}</span></button>`).join('')}</div>
    ${groups.map((group, index) => `<div class="deals-panel" id="deal-panel-${group.key}" role="tabpanel" aria-labelledby="deal-tab-${group.key}" data-deals-panel="${group.key}" ${index === 0 ? '' : 'hidden'}><div class="deals-panel__controls"><span>More offers</span><div><button class="rail-arrow" type="button" data-rail-button="prev" data-rail-id="deal-rail-${group.key}" aria-label="Previous offers" disabled>←</button><button class="rail-arrow" type="button" data-rail-button="next" data-rail-id="deal-rail-${group.key}" aria-label="Next offers">→</button></div></div><div class="deals-panel__track" id="deal-rail-${group.key}" tabindex="0" aria-label="${escapeHtml(group.label)} products">${group.products.map(productCard).join('')}</div></div>`).join('')}
  </section>`;
}

function homePage() {
  const heroSlides = [settings.hero, ...(settings.hero_slides || [])].slice(0, 3);
  const featured = settings.featured_products.map(findProduct).filter(Boolean).slice(0, 8);
  const categoryCards = (settings.category_cards || []).map((item) => ({ ...item, product: findProduct(item.product_handle), count: catalog.products.filter((product) => product.family === item.family).length })).filter((item) => item.product);
  const discoveryTiles = (settings.homepage_discovery_tiles || []).map((item) => ({ ...item, products: item.product_handles.map(findProduct).filter(Boolean).slice(0, 3) })).filter((item) => item.products.length);
  const wideProducts = settings.wide_campaign.product_handles.map(findProduct).filter(Boolean);
  const thematicProducts = settings.thematic_shelf.product_handles.map(findProduct).filter(Boolean);
  const thematicFeature = findProduct(settings.thematic_shelf.feature_handle);
  const pantryProducts = settings.pantry_products.map(findProduct).filter(Boolean);
  const editorialProducts = settings.editorial.product_handles.map(findProduct).filter(Boolean);
  const journalCards = (settings.journal_cards || []).map((card) => ({ ...card, products: card.product_handles.map(findProduct).filter(Boolean).slice(0, 2) })).filter((card) => card.products.length);
  const reservedHandles = new Set([
    ...heroSlides.flatMap((slide) => slide.product_handles),
    ...discoveryTiles.flatMap((tile) => tile.products.map((product) => product.handle)),
    ...categoryCards.map((card) => card.product.handle),
    ...featured.map((product) => product.handle),
    ...wideProducts.map((product) => product.handle),
    ...thematicProducts.map((product) => product.handle),
    thematicFeature?.handle,
    ...pantryProducts.map((product) => product.handle),
    ...editorialProducts.map((product) => product.handle),
    ...journalCards.flatMap((card) => card.products.map((product) => product.handle)),
  ].filter(Boolean));
  const deals = saleProducts().filter((product) => !reservedHandles.has(product.handle));
  const heroProductCutouts = {
    'now-lavender-oil-30ml': '/vitamin-express-preview/shared/assets/hero-products/now-lavender-oil-cutout.png',
    'now-essential-oils-lime-30ml': '/vitamin-express-preview/shared/assets/hero-products/now-lime-oil-cutout.png',
    'new-roots-vitamin-d3-2500iu-360-softgels': '/vitamin-express-preview/shared/assets/hero-products/new-roots-vitamin-d3-cutout.png',
    'aor-magnesium-glycinate-vegan-non-gmo-gluten-free-360-capsules': '/vitamin-express-preview/shared/assets/hero-products/aor-magnesium-glycinate-cutout.png',
    'organic-traditions-ceylon-cinnamon-powder-227g': '/vitamin-express-preview/shared/assets/hero-products/organic-traditions-cinnamon-cutout.png',
    'organic-traditions-organic-jumbo-pumpkin-seeds-227g': '/vitamin-express-preview/shared/assets/hero-products/organic-traditions-pumpkin-seeds-cutout.png',
  };
  const heroStage = (slide, mobile = false, priority = false) => {
    const products = slide.product_handles.map(findProduct).filter(Boolean).slice(0, 2);
    return `<div class="hero-stage hero-stage--${mobile ? 'mobile' : 'desktop'}"><img class="hero-lifestyle" src="${escapeHtml(slide.lifestyle_image)}" width="1440" height="960" alt="${mobile ? '' : escapeHtml(slide.lifestyle_alt || '')}" loading="${priority ? 'eager' : 'lazy'}" ${priority ? 'fetchpriority="high"' : ''}>${products.map((product, productIndex) => {
      const cutout = heroProductCutouts[product.handle];
      return `<a class="hero-product hero-product--lifestyle${cutout ? ' hero-product--cutout' : ''} hero-product-${productIndex + 1}" href="#/product/${encodeURIComponent(product.handle)}" aria-label="Shop ${escapeHtml(product.title)}"><img src="${cutout || productImage(product)}" width="${product.media[0].width || 600}" height="${product.media[0].height || 600}" alt="" loading="lazy"></a>`;
    }).join('')}</div>`;
  };
  const heroMarkup = `<section class="hero-carousel" data-hero-carousel data-autoplay="true" data-interval="5500" aria-roledescription="carousel" aria-label="Featured shopping campaigns">
    ${heroSlides.map((slide, index) => `<article class="hero hero-slide" data-hero-slide aria-roledescription="slide" aria-label="${index + 1} of ${heroSlides.length}" aria-hidden="${index === 0 ? 'false' : 'true'}" ${index === 0 ? '' : 'hidden'} style="--hero-bg:${escapeHtml(slide.background || '#F7C948')};--hero-accent:${escapeHtml(slide.accent || '#F26B4A')}"><div class="hero-inner">
      <div class="hero-copy"><span class="campaign-badge">${escapeHtml(slide.badge || 'Seasonal edit')}</span><p class="eyebrow">${escapeHtml(slide.eyebrow)}</p>${index === 0 ? `<h1>${escapeHtml(slide.heading)}</h1>` : `<h2>${escapeHtml(slide.heading)}</h2>`}<p>${escapeHtml(slide.body)}</p>
        <div class="hero-actions"><a class="button campaign" href="${escapeHtml(slide.primary_href)}">${escapeHtml(slide.primary_label)}</a><a class="text-link" href="${escapeHtml(slide.secondary_href)}">${escapeHtml(slide.secondary_label)} →</a></div>
      </div>${heroStage(slide, false, index === 0)}${heroStage(slide, true, index === 0)}
    </div></article>`).join('')}
    <div class="hero-carousel__controls" aria-label="Campaign controls"><button class="hero-carousel__arrow" type="button" data-hero-prev aria-label="Previous campaign">←</button><div class="hero-carousel__dots">${heroSlides.map((slide, index) => `<button class="hero-carousel__dot" type="button" data-hero-dot="${index}" aria-label="Show campaign ${index + 1}: ${escapeHtml(slide.heading)}" aria-current="${index === 0 ? 'true' : 'false'}"></button>`).join('')}</div><button class="hero-carousel__arrow" type="button" data-hero-next aria-label="Next campaign">→</button></div><p class="sr-only" data-hero-status aria-live="polite"></p>
  </section>`;
  return `${flashSaleBar()}${heroMarkup}
    <section class="section discovery-section" aria-labelledby="discovery-title"><h2 class="sr-only" id="discovery-title">Shop featured categories</h2>
      <div class="discovery-carousel"><button class="discovery-arrow discovery-arrow--prev" type="button" data-rail-button="prev" data-rail-id="discovery-row" aria-label="Previous categories" disabled>←</button><div class="discovery-row" id="discovery-row" tabindex="0" aria-label="Featured categories">${discoveryTiles.map(({ title, href, tone, products }) => `<a class="discovery-tile category-tone-${escapeHtml(tone)}" href="${escapeHtml(href)}" aria-label="Shop ${escapeHtml(title)}"><span class="discovery-media">${products.map((product, index) => `<img class="discovery-product discovery-product--${index + 1}" src="${productImage(product)}" width="${product.media[0].width || 400}" height="${product.media[0].height || 400}" alt="" loading="lazy">`).join('')}</span><strong>${escapeHtml(title)}</strong></a>`).join('')}</div><button class="discovery-arrow discovery-arrow--next" type="button" data-rail-button="next" data-rail-id="discovery-row" aria-label="Next categories">→</button></div>
    </section>
    ${productRail({ id: 'featured-rail', eyebrow: 'Popular picks', title: 'Best sellers', products: featured, href: '#/categories' })}
    ${exclusiveDeals(deals)}
    <section class="section wellness-section" aria-labelledby="wellness-goals-title"><div class="section-head"><div><h2 id="wellness-goals-title">Shop by Wellness Goals</h2></div><a href="#/categories">View all</a></div><div class="goal-grid">${settings.health_goals.map((goal) => `<a class="goal-card" href="${escapeHtml(goal.href)}" aria-label="${escapeHtml(goal.title)}. ${escapeHtml(goal.body)}"><span class="goal-card__media"><img src="${escapeHtml(goal.illustration)}" alt="" loading="lazy"></span><strong>${escapeHtml(goal.title)}</strong></a>`).join('')}</div></section>
    <section class="section wide-campaign"><div class="wide-campaign__copy"><p class="eyebrow">${escapeHtml(settings.wide_campaign.eyebrow)}</p><h2>${escapeHtml(settings.wide_campaign.heading)}</h2><p>${escapeHtml(settings.wide_campaign.body)}</p><a class="button" href="${escapeHtml(settings.wide_campaign.href)}">${escapeHtml(settings.wide_campaign.label)}</a></div><div class="wide-campaign__art" aria-label="Two sports nutrition products from the local catalog">${wideProducts.map((product, index) => `<a class="wide-campaign__product wide-campaign__product--${index + 1}" href="#/product/${encodeURIComponent(product.handle)}"><img src="${productImage(product)}" alt="${escapeHtml(product.media[0].alt)}" loading="lazy"></a>`).join('')}</div></section>
    ${productRail({ id: 'foundations-rail', eyebrow: settings.thematic_shelf.eyebrow, title: settings.thematic_shelf.heading, products: thematicProducts, href: settings.thematic_shelf.href, feature: settings.thematic_shelf.lifestyle_image ? `<article class="shelf-feature shelf-feature--lifestyle"><img src="${escapeHtml(settings.thematic_shelf.lifestyle_image)}" alt="${escapeHtml(settings.thematic_shelf.lifestyle_alt || '')}" loading="lazy"><div class="shelf-feature__copy"><p class="eyebrow">For growing routines</p><h3>${escapeHtml(settings.thematic_shelf.body)}</h3><a href="${escapeHtml(settings.thematic_shelf.href)}">Shop kids & family →</a></div></article>` : thematicFeature ? `<article class="shelf-feature"><div><p class="eyebrow">Compare before choosing</p><h3>${escapeHtml(settings.thematic_shelf.body)}</h3><a class="text-link" href="#/product/${encodeURIComponent(thematicFeature.handle)}">View product →</a></div><img src="${productImage(thematicFeature)}" alt="${escapeHtml(thematicFeature.media[0].alt)}" loading="lazy"></article>` : '' })}
    ${productRail({ id: 'pantry-rail', eyebrow: 'Food & healthy living', title: 'Pantry & daily living', products: pantryProducts, href: '#/collection/food-and-healthy-living' })}
    <section class="section editorial-feature"><div class="editorial-art" aria-label="Supplement label examples from the catalog"><span class="editorial-art__badge"><b>4</b><span>checks before<br>you choose</span></span>${editorialProducts.map((product, index) => `<img class="editorial-product editorial-product--${index + 1}" src="${productImage(product)}" alt="${escapeHtml(product.media[0].alt)}" loading="lazy">`).join('')}</div><div class="editorial-copy"><p class="eyebrow">${escapeHtml(settings.editorial.eyebrow)}</p><h2>${escapeHtml(settings.editorial.heading)}</h2><p>${escapeHtml(settings.editorial.body)}</p><ol class="editorial-checks"><li><span>01</span><div><strong>Serving size</strong><small>Per capsule, scoop or full serving</small></div></li><li><span>02</span><div><strong>Form</strong><small>Capsule, liquid, powder or chewable</small></div></li><li><span>03</span><div><strong>Strength</strong><small>Amount per serving, not just per unit</small></div></li><li><span>04</span><div><strong>Directions &amp; warnings</strong><small>Timing, age range and precautions</small></div></li></ol><a class="button secondary editorial-cta" href="${escapeHtml(settings.editorial.href)}">${escapeHtml(settings.editorial.label)} <span aria-hidden="true">→</span></a></div></section>
    ${brandsShelf()}
    <section class="section journal-section" aria-labelledby="journal-highlights-title"><div class="section-head"><div><p class="eyebrow">Practical, product-first reading</p><h2 id="journal-highlights-title">Wellness advice & guides</h2></div><a href="#/journal">Read all</a></div><div class="journal-grid">${journalCards.map((card) => `<article class="journal-card"><a class="journal-card__media journal-card__media--${escapeHtml(card.tone)}" href="${escapeHtml(card.href)}" aria-label="Read ${escapeHtml(card.title)}">${card.products.map((product) => `<img src="${productImage(product)}" alt="" loading="lazy">`).join('')}</a><div class="journal-card__copy"><p class="eyebrow">${escapeHtml(card.eyebrow)}</p><h3><a href="${escapeHtml(card.href)}">${escapeHtml(card.title)}</a></h3><p>${escapeHtml(card.excerpt)}</p><a href="${escapeHtml(card.href)}">Read guide →</a></div></article>`).join('')}</div></section>
    <section class="section service-section" aria-labelledby="service-title"><div class="section-head"><div><p class="eyebrow">Here when you need us</p><h2 id="service-title">Shop with confidence</h2></div></div><div class="service-grid"><a href="#/support"><strong>Shipping information</strong><span>Review delivery regions, rates and exclusions before ordering.</span><b>Learn more →</b></a><a href="#/support"><strong>Returns</strong><span>Check eligibility and instructions before opening a product.</span><b>Learn more →</b></a><a href="#/support"><strong>Product questions</strong><span>For personal suitability, speak with a qualified health professional.</span><b>Get guidance →</b></a></div></section>`;
}

function categoriesPage() {
  const grouped = Object.groupBy(catalog.products, (product) => product.family);
  const preferred = (settings.category_cards || []).map((item) => item.family);
  const families = [...preferred, ...Object.keys(grouped).filter((family) => !preferred.includes(family))];
  const tones = ['peach', 'lilac', 'sky', 'yellow', 'mint', 'coral', 'sky'];
  const cards = families.map((family, index) => {
    const products = grouped[family] || [];
    const configured = (settings.category_cards || []).find((item) => item.family === family);
    const representative = findProduct(configured?.product_handle) || products.find((product) => product.available_snapshot) || products[0];
    const second = products.find((product) => product.handle !== representative?.handle && product.vendor !== representative?.vendor) || products.find((product) => product.handle !== representative?.handle);
    const types = [...new Set(products.map((product) => cleanMenuLabel(product.product_type || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, 4);
    const tone = configured?.tone || tones[index % tones.length];
    return { family, products, representative, second, types, tone, brands: new Set(products.map((product) => product.vendor)).size };
  });
  const heroProducts = cards.map((card) => card.representative).filter(Boolean).slice(0, 3);
  const brandCount = new Set(catalog.products.map((product) => product.vendor)).size;
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:'Categories'}])}
    <section class="category-hub-hero" aria-labelledby="category-hub-title">
      <div class="category-hub-hero__copy"><p class="eyebrow">Find your wellness essentials</p><h1 id="category-hub-title">Shop all categories</h1><p>Start with a department, narrow by product type, then refine by format, preferences, brand and availability.</p><div class="category-hub-hero__actions"><a class="button" href="#/brands">Shop by brand</a><a class="button secondary" href="#/deals">View current offers</a></div>
      <dl class="category-hub-stats"><div><dt>${catalog.products.length}</dt><dd>products</dd></div><div><dt>${cards.length}</dt><dd>departments</dd></div><div><dt>${brandCount}</dt><dd>brands</dd></div></dl></div>
      <div class="category-hub-hero__art" aria-label="Products from the local catalog">${heroProducts.map((product, index) => `<a href="#/product/${encodeURIComponent(product.handle)}" class="category-hub-product category-hub-product--${index + 1}" aria-label="View ${escapeHtml(product.title)}"><img src="${productImage(product)}" width="${product.media[0].width || 640}" height="${product.media[0].height || 640}" alt="" loading="eager"></a>`).join('')}</div>
    </section>
    <nav class="category-jump" aria-label="Jump to a category">${cards.map((card) => `<a href="#category-${slugify(card.family)}">${escapeHtml(card.family)}</a>`).join('')}</nav>
    <section class="category-directory" aria-labelledby="category-directory-title"><div class="section-head"><div><p class="eyebrow">Departments and product types</p><h2 id="category-directory-title">Find the right shelf</h2><p>Each department uses authentic pack shots and links into the same filters, product pages and cart.</p></div></div>
      <div class="category-directory-grid">${cards.map((card) => `<article class="category-directory-card" id="category-${slugify(card.family)}"><a class="category-directory-card__visual category-tone-${escapeHtml(card.tone)}" href="#/collection/${slugify(card.family)}" aria-label="Explore ${escapeHtml(card.family)}">${card.representative ? `<img class="category-directory-product category-directory-product--1" src="${productImage(card.representative)}" width="${card.representative.media[0].width || 640}" height="${card.representative.media[0].height || 640}" alt="" loading="lazy">` : ''}${card.second ? `<img class="category-directory-product category-directory-product--2" src="${productImage(card.second)}" width="${card.second.media[0].width || 640}" height="${card.second.media[0].height || 640}" alt="" loading="lazy">` : ''}<span>${card.products.length} products</span></a><div class="category-directory-card__body"><div class="category-directory-card__head"><h3><a href="#/collection/${slugify(card.family)}">${escapeHtml(card.family)}</a></h3><small>${card.brands} brand${card.brands === 1 ? '' : 's'}</small></div><nav aria-label="${escapeHtml(card.family)} product types">${card.types.map((type) => `<a href="#/search?q=${encodeURIComponent(type)}&scope=${encodeURIComponent(card.family)}">${escapeHtml(type)} <span aria-hidden="true">→</span></a>`).join('')}</nav><a class="category-directory-card__cta" href="#/collection/${slugify(card.family)}">Explore department <span aria-hidden="true">→</span></a></div></article>`).join('')}</div>
    </section>
    <section class="section category-goals" aria-labelledby="category-goals-title"><div class="section-head"><div><p class="eyebrow">Browse by intent</p><h2 id="category-goals-title">Shop by Wellness Goals</h2><p>Image-led discovery paths lead to relevant catalog shelves without making treatment claims.</p></div></div><div class="goal-grid">${settings.health_goals.map((goal) => `<a class="goal-card" href="${escapeHtml(goal.href)}" aria-label="${escapeHtml(goal.title)}. ${escapeHtml(goal.body)}"><span class="goal-card__media"><img src="${escapeHtml(goal.illustration)}" alt="" loading="lazy"></span><strong>${escapeHtml(goal.title)}</strong></a>`).join('')}</div></section>`;
}

function dealsPage(params) {
  return listingPage({ title: 'Current catalog offers', sourceProducts: saleProducts(), params, emptyHint: 'No verified current/reference price pairs match these filters.' });
}

function familyBySlug(slug) {
  return [...new Set(catalog.products.map((product) => product.family))].find((family) => slugify(family) === slug);
}

function productSearchText(product) {
  return `${product.title} ${product.vendor} ${product.family} ${product.product_type || ''} ${product.tags.join(' ')} ${product.description_text || ''}`.toLowerCase();
}

function productSearchIndex(product) {
  return searchText(`${product.title} ${product.vendor} ${localizedSearchText(product.family)} ${localizedSearchText(cleanMenuLabel(product.product_type || ''))} ${product.tags.map(localizedSearchText).join(' ')} ${localizedSearchText(productFormat(product))}`);
}

function productMatchesTerms(product, terms) {
  const value = productSearchIndex(product);
  return terms.every((term) => term.length > 2
    ? value.includes(term)
    : new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(value));
}

function productFormat(product) {
  const value = productSearchText(product);
  if (/\bgumm(?:y|ies)\b/.test(value)) return 'Gummies';
  if (/\bsoftgels?\b/.test(value)) return 'Softgels';
  if (/\bcapsules?\b|\bcaps\b/.test(value)) return 'Capsules';
  if (/\bpowder\b/.test(value)) return 'Powder';
  if (/\btablets?\b/.test(value)) return 'Tablets';
  if (/\bliquid\b|\boils?\b|\bdrops?\b/.test(value)) return 'Liquid & oils';
  if (/\bcream\b|\blotion\b|\bgel\b|\bbalm\b/.test(value)) return 'Topicals';
  return '';
}

const ATTRIBUTE_FILTERS = [
  { value: 'vegan', label: 'Vegan', pattern: /\bvegan\b/i },
  { value: 'gluten-free', label: 'Gluten free', pattern: /\bgluten[ -]?free\b|\bno added gluten\b/i },
  { value: 'non-gmo', label: 'Non-GMO', pattern: /\bnon[ -]?gmo\b/i },
  { value: 'organic', label: 'Organic', pattern: /\borganic\b/i },
];

function productAttributes(product) {
  const value = productSearchText(product);
  return ATTRIBUTE_FILTERS.filter((attribute) => attribute.pattern.test(value)).map((attribute) => attribute.value);
}

function productStartingPriceMinor(product) {
  return Math.round(Number(product.price_range.min) * 100);
}

function matchesPriceBand(product, band) {
  const price = productStartingPriceMinor(product);
  if (band === 'under-20') return price < 2000;
  if (band === '20-40') return price >= 2000 && price < 4000;
  if (band === '40-plus') return price >= 4000;
  return true;
}

function selectedPriceRange(params) {
  const read = (key) => params.has(key) && params.get(key).trim() !== '' && Number.isFinite(Number(params.get(key))) && Number(params.get(key)) >= 0 ? Number(params.get(key)) : null;
  const min = read('min');
  const max = read('max');
  if (min === null && max === null) return null;
  return { min: Math.min(min ?? 0, max ?? Infinity), max: Math.max(min ?? 0, max ?? Infinity) };
}

function matchesPriceRange(variant, range) {
  const cents = Math.round(presentedPrice(variant.price.amount, variant.price.currency).amount * 100);
  return cents >= Math.round(presentedPrice(range.min).amount * 100) && cents <= Math.round(presentedPrice(range.max).amount * 100);
}

function priceRangeMarkup(products, range) {
  const rate = presentedPrice(1).amount;
  const ceiling = Math.max(1, Math.ceil(Math.max(range ? presentedPrice(range.min).amount : 0, range && Number.isFinite(range.max) ? presentedPrice(range.max).amount : 0, ...products.flatMap(product => product.variants.map(variant => presentedPrice(variant.price.amount, variant.price.currency).amount)))));
  const min = Math.min(ceiling, range ? presentedPrice(range.min).amount : 0).toFixed(2);
  const max = Math.min(ceiling, range ? presentedPrice(range.max).amount : ceiling).toFixed(2);
  return `<form class="price-range-form" data-price-range data-rate="${rate}">
    <p class="price-range-currency">${escapeHtml(presentedPrice(0).currency)} · <span>Price per pack</span></p>
    <div class="price-range-inputs"><label><span>From</span><input name="min" type="number" min="0" step="0.01" inputmode="decimal" value="${min}" required></label><span aria-hidden="true">–</span><label><span>To</span><input name="max" type="number" min="0" step="0.01" inputmode="decimal" value="${max}" required></label></div>
    <div class="price-range-sliders" style="--range-start:${Number(min) / ceiling * 100}%;--range-end:${Number(max) / ceiling * 100}%"><input type="range" data-price-slider="min" aria-label="Minimum price" min="0" max="${ceiling}" step="0.01" value="${min}"><input type="range" data-price-slider="max" aria-label="Maximum price" min="0" max="${ceiling}" step="0.01" value="${max}"></div>
    <p class="price-range-hint">Drag or enter your budget, then apply.</p><div class="price-range-actions"><button class="button secondary small" type="submit">Apply price</button><button class="text-button" type="button" data-reset-price>Reset</button></div>
  </form>`;
}

function updatePriceInputs(input) {
  const form = input.closest('[data-price-range]');
  const key = input.dataset.priceSlider || input.name;
  const slider = form.querySelector(`[data-price-slider="${key}"]`);
  const other = form.elements[key === 'min' ? 'max' : 'min'];
  const raw = Number(input.value);
  if (input.value === '' || !Number.isFinite(raw)) return;
  let value = Math.max(0, Math.min(Number(slider.max), raw));
  if (input.type === 'range') value = key === 'min' ? Math.min(value, Number(other.value)) : Math.max(value, Number(other.value));
  slider.value = value;
  if (input.type === 'range') form.elements[key].value = value.toFixed(2);
  form.elements.max.setCustomValidity(Number(form.elements.min.value) > Number(form.elements.max.value) ? t('Maximum price must be at least the minimum price.') : '');
  const track = form.querySelector('.price-range-sliders');
  track.style.setProperty('--range-start', `${Math.min(100, Number(form.elements.min.value) / Number(slider.max) * 100)}%`);
  track.style.setProperty('--range-end', `${Math.min(100, Number(form.elements.max.value) / Number(slider.max) * 100)}%`);
}

function listingPage({ title, sourceProducts, params, emptyHint = '' }) {
  const selectedBrands = params.getAll('brand');
  const selectedTypes = params.getAll('type');
  const selectedFormats = params.getAll('format');
  const selectedAttributes = params.getAll('attribute');
  const selectedPrice = params.get('price') || '';
  const priceRange = selectedPriceRange(params);
  const availableOnly = params.get('available') === '1';
  const sort = params.get('sort') || 'featured';
  const vendors = [...new Set(sourceProducts.map((product) => product.vendor))].sort((a,b) => a.localeCompare(b));
  const types = [...new Set(sourceProducts.map((product) => cleanMenuLabel(product.product_type || '')).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  const formats = [...new Set(sourceProducts.map(productFormat).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  const availableAttributes = ATTRIBUTE_FILTERS.filter((attribute) => sourceProducts.some((product) => productAttributes(product).includes(attribute.value)));
  const countFor = (predicate) => sourceProducts.filter(predicate).length;
  let products = sourceProducts.filter((product) => {
    const type = cleanMenuLabel(product.product_type || '');
    const format = productFormat(product);
    const attributes = productAttributes(product);
    return (!selectedBrands.length || selectedBrands.includes(product.vendor))
      && (!selectedTypes.length || selectedTypes.includes(type))
      && (!selectedFormats.length || selectedFormats.includes(format))
      && (!selectedAttributes.length || selectedAttributes.some((attribute) => attributes.includes(attribute)))
      && matchesPriceBand(product, selectedPrice)
      && (!priceRange || product.variants.some((variant) => (!availableOnly || variant.available_snapshot) && matchesPriceRange(variant, priceRange)))
      && (!availableOnly || product.available_snapshot);
  });
  if (sort === 'featured') products.sort((a,b) => Number(b.available_snapshot) - Number(a.available_snapshot));
  if (sort === 'price-asc') products.sort((a,b) => Number(a.price_range.min) - Number(b.price_range.min));
  if (sort === 'price-desc') products.sort((a,b) => Number(b.price_range.min) - Number(a.price_range.min));
  if (sort === 'saving') products.sort((a,b) => Math.max(...b.variants.map((variant) => priceState(variant).savingPercent)) - Math.max(...a.variants.map((variant) => priceState(variant).savingPercent)));
  if (sort === 'title') products.sort((a,b) => a.title.localeCompare(b.title));
  const chip = (param, value, label = value) => `<button class="chip" type="button" data-remove-facet data-param="${escapeHtml(param)}" data-value="${escapeHtml(value)}">${escapeHtml(label)} ×</button>`;
  const attributeLabels = Object.fromEntries(ATTRIBUTE_FILTERS.map((attribute) => [attribute.value, attribute.label]));
  const priceLabels = { 'under-20': `${t('Under')} ${moneyLabel(20)}`, '20-40': `${moneyLabel(20)}–${moneyLabel(39.99)}`, '40-plus': `${moneyLabel(40)}+` };
  const chips = [
    ...selectedBrands.map((value) => chip('brand', value)),
    ...selectedTypes.map((value) => chip('type', value)),
    ...selectedFormats.map((value) => chip('format', value)),
    ...selectedAttributes.map((value) => chip('attribute', value, attributeLabels[value] || value)),
    selectedPrice ? chip('price', selectedPrice, priceLabels[selectedPrice] || selectedPrice) : '',
    priceRange ? chip('range', '', `${moneyLabel(priceRange.min)} – ${Number.isFinite(priceRange.max) ? moneyLabel(priceRange.max) : t('Any price')}`) : '',
    availableOnly ? chip('available', '1', 'In stock') : '',
  ].join('');
  const filterCount = selectedBrands.length + selectedTypes.length + selectedFormats.length + selectedAttributes.length + (selectedPrice || priceRange ? 1 : 0) + (availableOnly ? 1 : 0);
  const checkboxList = (items, param, selected, predicate) => `<div class="filter-list">${items.map((item) => `<label class="filter-option"><input type="checkbox" data-facet data-param="${escapeHtml(param)}" value="${escapeHtml(item)}" ${selected.includes(item) ? 'checked' : ''}><span>${escapeHtml(item)}</span><span class="filter-count">${countFor((product) => predicate(product, item))}</span></label>`).join('')}</div>`;
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:title}])}<header class="listing-head"><h1 class="page-title">${escapeHtml(title)}</h1><p class="result-count" aria-live="polite">${products.length}${products.length === sourceProducts.length ? '' : ` of ${sourceProducts.length}`} products</p></header>
    <div class="toolbar"><button class="button secondary small mobile-only" type="button" data-toggle-filters aria-expanded="false">Filter${filterCount ? ` (${filterCount})` : ''}</button><label><span>Sort by</span><select data-sort><option value="featured" ${sort==='featured'?'selected':''}>Featured & available</option><option value="saving" ${sort==='saving'?'selected':''}>Biggest saving</option><option value="price-asc" ${sort==='price-asc'?'selected':''}>Price: low to high</option><option value="price-desc" ${sort==='price-desc'?'selected':''}>Price: high to low</option><option value="title" ${sort==='title'?'selected':''}>Name</option></select></label></div>
    <div class="selected-chips">${chips}${filterCount ? '<button class="chip chip-clear" type="button" data-clear-filters>Clear all</button>' : ''}</div>
    <div class="collection-layout"><aside class="filter-panel" aria-label="Product filters"><div class="filter-head"><h2>Filter products${filterCount ? ` (${filterCount})` : ''}</h2><button class="icon-button mobile-only" type="button" data-toggle-filters aria-label="Close filters">${icon('close')}</button></div>
      <label class="filter-option filter-availability"><input type="checkbox" data-available ${availableOnly?'checked':''}><span>In stock only</span><span class="filter-count">${countFor((product) => product.available_snapshot)}</span></label>
      <details class="filter-group" open><summary>Price</summary>${priceRangeMarkup(sourceProducts, priceRange)}</details>
      <details class="filter-group" open><summary>Product type</summary>${checkboxList(types, 'type', selectedTypes, (product, value) => cleanMenuLabel(product.product_type || '') === value)}</details>
      ${formats.length ? `<details class="filter-group" open><summary>Format</summary>${checkboxList(formats, 'format', selectedFormats, (product, value) => productFormat(product) === value)}</details>` : ''}
      ${availableAttributes.length ? `<details class="filter-group" open><summary>Preferences</summary><div class="filter-list">${availableAttributes.map((attribute) => `<label class="filter-option"><input type="checkbox" data-facet data-param="attribute" value="${escapeHtml(attribute.value)}" ${selectedAttributes.includes(attribute.value) ? 'checked' : ''}><span>${escapeHtml(attribute.label)}</span><span class="filter-count">${countFor((product) => productAttributes(product).includes(attribute.value))}</span></label>`).join('')}</div></details>` : ''}
      <details class="filter-group"><summary>Brand</summary>${checkboxList(vendors, 'brand', selectedBrands, (product, value) => product.vendor === value)}</details>
      <button class="button filter-apply mobile-only" type="button" data-toggle-filters>View ${products.length} products</button></aside>
      <div>${products.length ? `<p class="comparison-hint">Want a closer look? Compare up to 3 products.</p>${productGrid(products, { query: params.get('q') || '', priceRange, availableOnly, comparison: true })}` : `<div class="empty-state"><h2>No matches</h2><p>${escapeHtml(emptyHint || 'Clear a filter or try another search.')}</p><button class="button secondary" type="button" data-clear-filters>Clear filters</button></div>`}</div></div><div data-comparison-tray>${comparisonTrayMarkup()}</div><dialog class="comparison-dialog" id="product-comparison" aria-labelledby="comparison-title"></dialog>`;
}

function collectionPage(slug, params) {
  const family = familyBySlug(slug);
  if (!family) return notFoundPage();
  return listingPage({ title: family, sourceProducts: catalog.products.filter((product) => product.family === family), params });
}

function kidsFamilyPage(params) {
  const products = settings.thematic_shelf.product_handles.map(findProduct).filter(Boolean);
  return listingPage({ title: settings.thematic_shelf.heading, sourceProducts: products, params, emptyHint: 'Clear a filter to see more kids and family essentials.' });
}

function searchPage(params) {
  const query = (params.get('q') || '').trim();
  const scope = params.get('scope') || '';
  const terms = searchText(query).split(/\s+/).filter(Boolean);
  const matches = catalog.products.filter((product) => (!scope || product.family === scope) && productMatchesTerms(product, terms));
  const scopedTitle = scope ? ` in ${scope}` : '';
  return listingPage({ title: query ? `Results for “${query}”${scopedTitle}` : `Search${scopedTitle}`, sourceProducts: matches, params, emptyHint: query ? `We couldn’t find “${query}”${scopedTitle}. Try a brand, ingredient or a shorter term.` : 'Enter a product, brand or ingredient.' });
}

function updateAutocomplete(input) {
  const panel = input.closest('[data-search-form]')?.querySelector('.search-suggestions');
  if (!panel) return;
  const query = searchText(input.value.trim());
  if (query.length < 2) {
    panel.hidden = true;
    panel.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    return;
  }
  const terms = query.split(/\s+/).filter(Boolean);
  const scope = input.closest('[data-search-form]').querySelector('[name="scope"]')?.value || '';
  const eligibleProducts = catalog.products.filter((product) => !scope || product.family === scope);
  const matches = eligibleProducts.filter((product) => productMatchesTerms(product, terms))
    .sort((a, b) => Number(productSearchIndex(b).includes(query)) - Number(productSearchIndex(a).includes(query)) || Number(b.available_snapshot) - Number(a.available_snapshot))
    .slice(0, 5);
  const brands = [...new Set(eligibleProducts.map((product) => product.vendor))]
    .filter((brand) => terms.every((term) => searchText(brand).includes(term))).slice(0, 2);
  const families = scope ? [] : [...new Set(catalog.products.map((product) => product.family))]
    .filter((family) => terms.every((term) => localizedSearchText(family).includes(term))).slice(0, 2);
  const scopeParam = scope ? `&scope=${encodeURIComponent(scope)}` : '';
  const productSuggestions = matches.length ? `<p class="suggestion-heading">Products</p>${matches.map((product) => { const matched = variantFromSearch(product, query); return `<a class="suggestion" role="option" href="${productHref(product, matched?.source_id || '')}"><img src="${productImage(product)}" width="56" height="56" alt=""><span><small>${escapeHtml(product.vendor)} · ${escapeHtml(matched?.title || product.family)}</small><strong>${escapeHtml(product.title)}</strong>${product.available_snapshot ? '' : '<em>Out of stock</em>'}</span><b>${escapeHtml(matched ? moneyLabel(matched.price.amount, matched.price.currency) : `${money(product.price_range.min)}${product.price_range.min !== product.price_range.max ? '+' : ''}`)}</b></a>`; }).join('')}` : '';
  const discoverySuggestions = brands.length || families.length ? `<div class="suggestion-discovery">${families.map((family) => `<a role="option" href="#/collection/${slugify(family)}"><small>Category</small><strong>${escapeHtml(family)}</strong></a>`).join('')}${brands.map((brand) => `<a role="option" href="#/brand/${slugify(brand)}"><small>Brand</small><strong>${escapeHtml(brand)}</strong></a>`).join('')}</div>` : '';
  panel.innerHTML = matches.length || brands.length || families.length
    ? `${discoverySuggestions}${productSuggestions}<a class="suggestion-all" role="option" href="#/search?q=${encodeURIComponent(input.value.trim())}${scopeParam}">View all results →</a>`
    : `<div class="suggestion-empty" role="status"><strong>No matches yet</strong><span>Try a brand, ingredient or shorter search.</span><div><a href="#/collection/vitamins">Vitamins</a><a href="#/collection/minerals">Minerals</a><a href="#/categories">All categories</a></div></div>`;
  localize(panel);
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function closeAutocomplete(input = document.querySelector('#site-search')) {
  const panel = input?.closest('[data-search-form]')?.querySelector('.search-suggestions');
  if (panel) { panel.hidden = true; input.setAttribute('aria-expanded', 'false'); }
}

function openMega({ trigger = document.querySelector('[data-mega-trigger]'), focusFirst = false } = {}) {
  const menu = document.querySelector('[data-mega-menu]');
  if (!trigger || !menu) return;
  clearTimeout(openMega.timer);
  const key = trigger.dataset.megaKey || 'all';
  document.querySelectorAll('[data-mega-trigger]').forEach((button) => button.setAttribute('aria-expanded', String(button === trigger)));
  menu.querySelectorAll('[data-mega-panel]').forEach((panel) => { panel.hidden = panel.dataset.megaPanel !== key; });
  menu.hidden = false;
  menu.dataset.activeKey = key;
  if (focusFirst) menu.querySelector('[data-mega-panel]:not([hidden]) a')?.focus();
}

function closeMega({ returnFocus = false } = {}) {
  const menu = document.querySelector('[data-mega-menu]');
  const trigger = document.querySelector('[data-mega-trigger][aria-expanded="true"]');
  if (!menu) return;
  menu.hidden = true;
  document.querySelectorAll('[data-mega-trigger]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  if (returnFocus && trigger) {
    suppressMegaFocusOpen = true;
    trigger.focus();
    suppressMegaFocusOpen = false;
  }
}

function showHeroSlide(index, { announce = false } = {}) {
  const carousel = document.querySelector('[data-hero-carousel]');
  if (!carousel) return;
  const slides = [...carousel.querySelectorAll('[data-hero-slide]')];
  if (!slides.length) return;
  const nextIndex = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === nextIndex;
    slide.hidden = !active;
    slide.setAttribute('aria-hidden', String(!active));
  });
  carousel.querySelectorAll('[data-hero-dot]').forEach((dot, dotIndex) => dot.setAttribute('aria-current', String(dotIndex === nextIndex)));
  carousel.dataset.activeSlide = String(nextIndex);
  if (announce) {
    const status = carousel.querySelector('[data-hero-status]');
    if (status) status.textContent = t(`Campaign ${nextIndex + 1} of ${slides.length}: ${slides[nextIndex].querySelector('h1,h2')?.textContent || ''}`);
  }
}

function stopHeroAutoplay() {
  clearInterval(heroTimer);
  heroTimer = undefined;
}

function startHeroAutoplay() {
  stopHeroAutoplay();
  const carousel = document.querySelector('[data-hero-carousel]');
  if (!carousel || carousel.dataset.autoplay !== 'true' || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const slides = carousel.querySelectorAll('[data-hero-slide]');
  if (slides.length < 2) return;
  const interval = Math.max(5000, Number(carousel.dataset.interval) || 6500);
  heroTimer = setInterval(() => {
    const active = Number(carousel.dataset.activeSlide || 0);
    showHeroSlide(active + 1);
  }, interval);
}

function setupHeroCarousel() {
  stopHeroAutoplay();
  const carousel = document.querySelector('[data-hero-carousel]');
  if (!carousel) return;
  showHeroSlide(Number(carousel.dataset.activeSlide || 0));
  startHeroAutoplay();
}

function setupOfferCountdown() {
  clearInterval(offerTimer);
  offerTimer = undefined;
  const countdown = document.querySelector('[data-offer-countdown]');
  if (!countdown) return;
  const configuredEnd = Date.parse(countdown.dataset.end || '');
  const isScheduled = Number.isFinite(configuredEnd) && configuredEnd > Date.now();
  const end = isScheduled ? configuredEnd : Date.now() + (30 * 60 * 60 * 1000);
  const fields = {
    days: countdown.querySelector('[data-countdown-days]'),
    hours: countdown.querySelector('[data-countdown-hours]'),
    minutes: countdown.querySelector('[data-countdown-minutes]'),
    seconds: countdown.querySelector('[data-countdown-seconds]'),
  };
  const update = () => {
    const remaining = Math.max(0, end - Date.now());
    const values = {
      days: Math.floor(remaining / 86400000),
      hours: Math.floor((remaining % 86400000) / 3600000),
      minutes: Math.floor((remaining % 3600000) / 60000),
      seconds: Math.floor((remaining % 60000) / 1000),
    };
    Object.entries(values).forEach(([key, value]) => { if (fields[key]) fields[key].textContent = String(value).padStart(2, '0'); });
    countdown.dataset.scheduled = String(isScheduled);
    countdown.querySelector('.flash-sale-clock')?.setAttribute('aria-label', t(`${isScheduled ? '' : 'Preview countdown: '}${values.days} days, ${values.hours} hours, ${values.minutes} minutes and ${values.seconds} seconds remaining`));
    if (!remaining) { clearInterval(offerTimer); offerTimer = undefined; }
  };
  update();
  offerTimer = setInterval(update, 1000);
}

function selectDealsTab(key, { focus = false } = {}) {
  const section = document.querySelector('[data-deals]');
  if (!section) return;
  section.querySelectorAll('[data-deals-tab]').forEach((tab) => {
    const active = tab.dataset.dealsTab === key;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  section.querySelectorAll('[data-deals-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.dealsPanel !== key;
    if (!panel.hidden) syncRailButtons(panel.querySelector('.deals-panel__track')?.id);
  });
}

function moveHeroSlide(nextIndex) {
  showHeroSlide(nextIndex, { announce: true });
  startHeroAutoplay();
}

function syncRailButtons(id) {
  const rail = document.getElementById(id);
  if (!rail) return;
  const atStart = rail.scrollLeft <= 2;
  const atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
  document.querySelector(`[data-rail-id="${id}"][data-rail-button="prev"]`)?.toggleAttribute('disabled', atStart);
  document.querySelector(`[data-rail-id="${id}"][data-rail-button="next"]`)?.toggleAttribute('disabled', atEnd);
}

function updateCompactHeader() {
  const header = document.querySelector('[data-site-header]');
  if (!header) return;

  if (window.scrollY > 140) {
    header.classList.add('compact');
  } else if (window.scrollY < 70) {
    header.classList.remove('compact');
  }
}

function updateHeaderFit() {
  const headerMain = document.querySelector('.header-main');
  const navInner = document.querySelector('.nav-inner');
  const searchInput = document.querySelector('#site-search');
  if (!headerMain || !searchInput) return;
  const textZoomed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) >= 24;
  headerMain.classList.toggle('text-zoom-layout', textZoomed);
  navInner?.classList.toggle('text-zoom-layout', textZoomed);
  headerMain.classList.toggle('action-labels-hidden', innerWidth <= 1120 || textZoomed || searchInput.getBoundingClientRect().width < 180);
}

function brandsPage() {
  const brands = [...new Set(catalog.products.map((product) => product.vendor))].sort((a,b) => a.localeCompare(b));
  const groups = Object.groupBy(brands, (brand) => brand[0].toUpperCase());
  const counts = new Map(brands.map((brand) => [brand, catalog.products.filter((product) => product.vendor === brand).length]));
  const alphabet = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const directory = Object.entries(groups).map(([letter, names]) => `<section class="brand-letter-section" data-brand-letter="${escapeHtml(letter)}"><h2>${escapeHtml(letter)}</h2><div>${names.map((brand) => `<a data-brand-item data-brand-name="${escapeHtml(brand.toLowerCase())}" href="#/brand/${slugify(brand)}"><span>${escapeHtml(brand)}</span><small>${counts.get(brand)} product${counts.get(brand) === 1 ? '' : 's'}</small></a>`).join('')}</div></section>`).join('');
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:'Brands'}])}
    <section class="brand-directory-hero"><div><p class="eyebrow">A–Z directory</p><h1 class="page-title">Shop by brand</h1><p class="lede">${brands.length} authentic catalog brands, organized for fast scanning instead of oversized cards.</p></div><div class="brand-directory-mark" aria-hidden="true">A–Z</div></section>
    <section class="brand-directory-tools" aria-label="Find a brand"><label for="brand-search">Search brands</label><div class="brand-search-control">${icon('search')}<input id="brand-search" type="search" data-brand-search autocomplete="off" placeholder="Search by brand name"><button type="button" data-clear-brand-search>Clear</button></div><div class="brand-alphabet" aria-label="Jump to a brand letter">${alphabet.map((letter) => `<button type="button" data-brand-jump="${escapeHtml(letter)}" ${letter !== '#' && !groups[letter] ? 'disabled' : ''}>${letter === '#' ? 'All' : escapeHtml(letter)}</button>`).join('')}</div><p class="brand-result-status" data-brand-result-status aria-live="polite">Showing ${brands.length} brands</p></section>
    <div class="brand-directory-list" data-brand-directory>${directory}</div>`;
}

function canadianOwnedPage(params = new URLSearchParams()) {
  const config = settings.canadian_owned || {};
  const verifiedBrands = new Set(config.verified_brands || []);
  const sourceProducts = catalog.products.filter((product) => verifiedBrands.has(product.vendor));
  const selectedBrands = params.getAll('brand');
  const availableOnly = params.get('available') === '1';
  const sort = params.get('sort') || 'featured';
  const counts = Object.fromEntries([...verifiedBrands].map((brand) => [brand, sourceProducts.filter((product) => product.vendor === brand).length]));
  let products = sourceProducts.filter((product) => (!selectedBrands.length || selectedBrands.includes(product.vendor)) && (!availableOnly || product.available_snapshot));
  if (sort === 'price-asc') products.sort((a,b) => Number(a.price_range.min) - Number(b.price_range.min));
  if (sort === 'price-desc') products.sort((a,b) => Number(b.price_range.min) - Number(a.price_range.min));
  if (sort === 'title') products.sort((a,b) => a.title.localeCompare(b.title));
  const featured = (config.feature_handles || []).map(findProduct).filter((product) => product && verifiedBrands.has(product.vendor));
  const campaignArt = (config.campaign_art_handles || []).map(findProduct).filter((product) => product && verifiedBrands.has(product.vendor));
  const featuredHandles = new Set(featured.map((product) => product.handle));
  const refinementActive = selectedBrands.length > 0 || availableOnly || sort !== 'featured';
  const remaining = refinementActive ? products : products.filter((product) => !featuredHandles.has(product.handle));
  const chips = [...selectedBrands.map((brand) => `<button class="chip" type="button" data-remove-filter="${escapeHtml(brand)}">${escapeHtml(brand)} ×</button>`), availableOnly ? '<button class="chip" type="button" data-remove-available>In stock ×</button>' : ''].join('');
  const filterCount = selectedBrands.length + (availableOnly ? 1 : 0);
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:'Shop Canadian owned'}])}
    <header class="canadian-owned-intro"><h1 class="page-title">${escapeHtml(config.heading || 'Shop Canadian owned')}</h1><p>${escapeHtml(config.intro || '')}</p></header>
    ${refinementActive ? '' : `<section class="canadian-owned-showcase" aria-labelledby="canadian-campaign-title">
      <div class="canadian-owned-campaign"><div><p class="eyebrow">${canadaFlag()} ${escapeHtml(config.campaign_eyebrow || 'Canadian brand edit')}</p><h2 id="canadian-campaign-title">${escapeHtml(config.campaign_heading || 'Canadian brands, clearly gathered.')}</h2><p>${escapeHtml(config.campaign_body || '')}</p><a class="button" href="#canadian-products">Shop the collection</a></div><div class="canadian-campaign-products" aria-hidden="true">${campaignArt.map((product) => `<img src="${productImage(product)}" alt="" loading="eager">`).join('')}</div></div>
      <div class="canadian-owned-featured">${featured.map((product) => productCard(product)).join('')}</div>
    </section>`}
    <section class="section canadian-owned-products" id="canadian-products" aria-labelledby="canadian-products-title"><div class="section-head"><div><p class="eyebrow">Current local assortment</p><h2 id="canadian-products-title">Shop Canadian brands</h2></div><p class="result-count" aria-live="polite">${products.length}${products.length === sourceProducts.length ? '' : ` of ${sourceProducts.length}`} products · ${verifiedBrands.size} sourced brands</p></div>
      <div class="toolbar"><button class="button secondary small mobile-only" type="button" data-toggle-filters aria-expanded="false">Filter${filterCount ? ` (${filterCount})` : ''}</button><label><span>Sort by</span><select data-sort><option value="featured" ${sort==='featured'?'selected':''}>Featured</option><option value="price-asc" ${sort==='price-asc'?'selected':''}>Price: low to high</option><option value="price-desc" ${sort==='price-desc'?'selected':''}>Price: high to low</option><option value="title" ${sort==='title'?'selected':''}>Name</option></select></label></div>
      <div class="selected-chips">${chips}</div><div class="collection-layout"><aside class="filter-panel" aria-label="Product filters"><div class="filter-head"><h2>Filters</h2><button class="icon-button mobile-only" type="button" data-toggle-filters aria-label="Close filters">${icon('close')}</button></div><label class="filter-option"><input type="checkbox" data-available ${availableOnly?'checked':''}><span>In stock only</span><span class="filter-count">${sourceProducts.filter((product) => product.available_snapshot).length}</span></label><hr><h2>Brand</h2><div class="filter-list">${[...verifiedBrands].map((brand) => `<label class="filter-option"><input type="checkbox" data-brand value="${escapeHtml(brand)}" ${selectedBrands.includes(brand)?'checked':''}><span>${escapeHtml(brand)}</span><span class="filter-count">${counts[brand]}</span></label>`).join('')}</div><button class="button filter-apply mobile-only" type="button" data-toggle-filters>View ${products.length} products</button></aside><div>${remaining.length ? productGrid(remaining) : `<div class="empty-state"><h2>No matches</h2><p>Clear a filter to see the sourced Canadian-brand edit.</p><button class="button secondary" type="button" data-clear-filters>Clear filters</button></div>`}</div></div>
    </section>
    <aside class="canadian-source-note"><strong>Why this edit is smaller than a broad “Made in Canada” list</strong><p>Brand inclusion requires current official ownership evidence. Country of manufacture, a maple leaf, or a Canadian distributor alone is not treated as proof of ownership.</p><a href="../CANADIAN_OWNED_AUDIT.md" target="_blank" rel="noopener">Review inclusion sources →</a></aside>`;
}

function filterBrandDirectory(value = '') {
  const query = String(value).trim().toLocaleLowerCase();
  let visible = 0;
  document.querySelectorAll('[data-brand-item]').forEach((item) => {
    item.hidden = Boolean(query && !item.dataset.brandName.includes(query));
    if (!item.hidden) visible += 1;
  });
  document.querySelectorAll('[data-brand-letter]').forEach((section) => {
    section.hidden = !section.querySelector('[data-brand-item]:not([hidden])');
  });
  const status = document.querySelector('[data-brand-result-status]');
  if (status) status.textContent = t(query ? `${visible} brand${visible === 1 ? '' : 's'} match “${value.trim()}”` : `Showing ${visible} brands`);
}

function brandPage(slug, params) {
  const brand = [...new Set(catalog.products.map((product) => product.vendor))].find((name) => slugify(name) === slug);
  if (!brand) return notFoundPage();
  return listingPage({ title: brand, sourceProducts: catalog.products.filter((product) => product.vendor === brand), params });
}

function structuredProductContent(text = '') {
  const definitions = [
    ['Product Overview', 'overview'], ['Overview', 'overview'], ['Key Features', 'highlights'], ['Highlights', 'highlights'],
    ['Medicinal Ingredients', 'ingredients'], ['Non-Medicinal Ingredients', 'ingredients'], ['Supplement Facts', 'ingredients'], ['Ingredients', 'ingredients'],
    ['Suggested Use', 'directions'], ['Recommended Dose', 'directions'], ['Directions', 'directions'],
    ['Warnings', 'warnings'], ['Cautions', 'warnings'], ['Disclaimer', 'warnings'], ['Product Details', 'details'], ['A. Vogel Advantage', 'details'],
  ];
  let normalized = String(text).replace(/\r/g, '').trim();
  for (const [label] of definitions) normalized = normalized.replace(new RegExp(`(?:^|\\n|\\s)(?:${label.replace('.', '\\.')})(?=\\s|:|$)`, 'gi'), `\n${label}\n`);
  const buckets = { overview: [], highlights: [], ingredients: [], directions: [], warnings: [], details: [] };
  let active = 'overview';
  for (const rawLine of normalized.split('\n').map((line) => line.trim()).filter(Boolean)) {
    const cleanLine = rawLine.replace(/^:\s*/, '');
    if (!cleanLine) continue;
    const definition = definitions.find(([label]) => label.toLowerCase() === cleanLine.replace(/:$/, '').toLowerCase());
    if (definition) { active = definition[1]; continue; }
    buckets[active].push(cleanLine);
  }
  return buckets;
}

function contentBlock(id, title, values, { list = false, warning = false } = {}) {
  if (!values?.length) return '';
  const body = list && values.length > 1
    ? `<ul>${values.slice(0, 8).map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
    : values.map((value) => `<p>${escapeHtml(value)}</p>`).join('');
  return `<section id="${id}" class="product-content-section${warning ? ' warning' : ''}" tabindex="-1"><h2>${escapeHtml(title)}</h2><div lang="en" translate="no">${body}</div></section>`;
}

function mediaForVariant(product, variant) {
  const mediaId = variant?.featured_media_id || variant?.media_source_id;
  const exact = mediaId ? product.media.find((media) => String(media.source_media_id) === String(mediaId)) : null;
  return { media: exact || product.media[0], exact: Boolean(exact) };
}

function sourceBackedAttributes(product) {
  const source = `${product.title} ${product.description_text || ''} ${(product.tags || []).join(' ')}`;
  return [
    ['Vegan', /\bvegan(?:-friendly)?\b/i],
    ['Gluten free', /\bgluten[ -]?free\b/i],
    ['Non-GMO', /\bnon[ -]?gmo\b/i],
    ['Organic', /\borganic\b/i],
  ].filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

function unitPriceLabel(product, variant) {
  const source = variant?.title && variant.title !== 'Default Title' ? variant.title : product.title;
  const matches = [...source.matchAll(/(\d+(?:\.\d+)?)\s*(veggie capsules?|vegetable capsules?|capsules?|caps|softgels?|soft gels?|tablets?|tabs|ml|g)\b/gi)];
  const match = matches.at(-1);
  const priceMinor = moneyMinor(variant?.price?.amount);
  if (!match || !priceMinor || Number(match[1]) <= 0) return '';
  const rawUnit = match[2].toLowerCase().replace(/\s+/g, ' ');
  const unit = rawUnit === 'ml' ? 'mL' : rawUnit === 'g' ? 'g' : rawUnit.includes('soft') ? 'softgel' : rawUnit.includes('tab') ? 'tablet' : 'capsule';
  return `${moneyLabel((priceMinor / Number(match[1])) / 100, variant.price.currency)} / ${unit}`;
}

function productDiscoverySets(product) {
  const productTags = new Set((product.tags || []).map((tag) => tag.toLowerCase()));
  const candidates = catalog.products.filter((candidate) => candidate.handle !== product.handle && candidate.available_snapshot);
  const score = (candidate) => {
    const sharedTags = (candidate.tags || []).filter((tag) => productTags.has(tag.toLowerCase())).length;
    return (candidate.product_type === product.product_type ? 18 : 0) + (candidate.family === product.family ? 8 : 0) + (candidate.vendor === product.vendor ? 5 : 0) + Math.min(sharedTags, 4);
  };
  const ranked = [...candidates].sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title));
  const used = new Set();
  const take = (pool, count = 8) => pool.filter((item) => !used.has(item.handle)).slice(0, count).map((item) => { used.add(item.handle); return item; });
  const similarPool = ranked.filter((item) => item.product_type === product.product_type || item.family === product.family);
  const similar = take(similarPool);
  const more = take(ranked.filter((item) => item.vendor === product.vendor || item.family === product.family).concat(ranked));
  const companionFamilies = {
    Vitamins: ['Minerals', 'Everyday Wellness', 'Food & Healthy Living'],
    Minerals: ['Vitamins', 'Everyday Wellness', 'Sports Nutrition'],
    'Digestive & Gut Health': ['Food & Healthy Living', 'Everyday Wellness', 'Vitamins'],
    'Sports Nutrition': ['Minerals', 'Food & Healthy Living', 'Everyday Wellness'],
    'Beauty & Personal Care': ['Everyday Wellness', 'Vitamins', 'Food & Healthy Living'],
    'Food & Healthy Living': ['Digestive & Gut Health', 'Everyday Wellness', 'Vitamins'],
    'Everyday Wellness': ['Vitamins', 'Minerals', 'Food & Healthy Living'],
  }[product.family] || [];
  const companionPool = [...candidates].sort((a, b) => {
    const aRank = companionFamilies.indexOf(a.family);
    const bRank = companionFamilies.indexOf(b.family);
    return (aRank < 0 ? 99 : aRank) - (bRank < 0 ? 99 : bRank) || score(b) - score(a);
  });
  const together = take(companionPool);
  return { similar, more, together };
}

function pdpProductRail({ id, eyebrow, title, products, href }) {
  if (!products.length) return '';
  return `<section class="pdp-recommendation product-rail" aria-labelledby="${id}-title">
    <div class="section-head"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2 id="${id}-title">${escapeHtml(title)}</h2></div><div class="rail-actions"><button class="rail-arrow" type="button" data-rail-button="prev" data-rail-id="${id}" aria-label="Previous ${escapeHtml(title)}" disabled>←</button><button class="rail-arrow" type="button" data-rail-button="next" data-rail-id="${id}" aria-label="Next ${escapeHtml(title)}">→</button><a href="${href}">View all</a></div></div>
    <div class="product-rail__track" id="${id}" tabindex="0" aria-label="${escapeHtml(title)} products">${products.map(productCard).join('')}</div>
  </section>`;
}

function productPage(handle, params) {
  const product = findProduct(decodeURIComponent(handle));
  if (!product) return notFoundPage();
  const requestedVariant = params.get('variant');
  const selected = product.variants.find((variant) => variant.source_id === requestedVariant) || product.variants.find((variant) => variant.available_snapshot) || product.variants[0];
  const invalidDeepLink = requestedVariant && selected.source_id !== requestedVariant;
  const mediaState = mediaForVariant(product, selected);
  const sections = structuredProductContent(product.description_text);
  const optionName = product.options?.[0]?.name === 'Size' ? 'Pack size' : product.options?.[0]?.name || 'Option';
  const mediaNote = product.variants.length > 1 && !mediaState.exact ? `Product image shown. Packaging may vary for ${selected.title}.` : '';
  const gallery = `<div class="pdp-gallery"><button class="pdp-media" type="button" data-open-zoom data-zoom-src="/vitamin-express-preview/catalog/${escapeHtml(mediaState.media.local_path)}" aria-label="Enlarge ${escapeHtml(product.title)} image">${icon('zoom')}<img src="/vitamin-express-preview/catalog/${escapeHtml(mediaState.media.local_path)}" width="${mediaState.media.width || 800}" height="${mediaState.media.height || 800}" alt="${escapeHtml(mediaState.media.alt)}"></button><div class="pdp-thumbnails" aria-label="Product images">${product.media.map((media, index) => `<button type="button" data-gallery-image="/vitamin-express-preview/catalog/${escapeHtml(media.local_path)}" aria-current="${String(media.local_path === mediaState.media.local_path)}" aria-label="Show image ${index + 1} of ${product.media.length}"><img src="/vitamin-express-preview/catalog/${escapeHtml(media.local_path)}" alt="" loading="lazy"></button>`).join('')}</div><p class="media-note">${escapeHtml(mediaNote)}</p></div>`;
  const variants = product.variants.length > 1 ? `<fieldset class="variant-group"><legend>${escapeHtml(optionName)}: <strong>${escapeHtml(selected.title)}</strong></legend><p class="pack-size-help">Choose a pack. Price updates with your selection.</p><div class="variant-options">${product.variants.map((variant, index) => { const state = priceState(variant); const unit = unitPriceLabel(product, variant); return `<input class="variant-radio" type="radio" id="variant-${escapeHtml(product.handle)}-${index}" name="variant" value="${escapeHtml(variant.source_id)}" data-variant-option ${variant.source_id === selected.source_id ? 'checked' : ''}><label for="variant-${escapeHtml(product.handle)}-${index}" class="variant-option${variant.available_snapshot ? '' : ' is-unavailable'}"><span>${escapeHtml(variant.title)}</span><small class="pack-price">${moneyLabel(variant.price.amount, variant.price.currency)}${state.onSale ? ` · ${t('Save')} ${state.savingPercent}%` : ''}</small>${unit ? `<small>${escapeHtml(unit)}</small>` : ''}<b aria-hidden="true">${icon('check')}</b><em>${variant.available_snapshot ? 'Available' : 'Sold out in snapshot'}</em></label>`; }).join('')}</div><p class="sr-only" data-variant-status role="status"></p></fieldset>` : '';
  const attributes = sourceBackedAttributes(product);
  const unitPrice = unitPriceLabel(product, selected);
  const discovery = productDiscoverySets(product);
  const disclosureRows = [
    sections.overview.length ? `<details open><summary>Description</summary>${contentBlock('about-product','About this product',sections.overview)}</details>` : null,
    sections.highlights.length ? `<details><summary>Product highlights</summary>${contentBlock('product-highlights','Highlights',sections.highlights,{list:true})}</details>` : null,
    sections.ingredients.length ? `<details><summary>Ingredients / supplement facts</summary>${contentBlock('ingredients','Ingredients / supplement facts',sections.ingredients)}</details>` : null,
    sections.directions.length ? `<details><summary>Suggested use</summary>${contentBlock('directions','Directions from the supplied description',sections.directions)}</details>` : null,
    sections.warnings.length ? `<details><summary>Warnings & disclaimer</summary>${contentBlock('warnings','Warnings & disclaimer',sections.warnings,{warning:true})}</details>` : null,
    `<details><summary>Product details</summary><section id="product-details" class="product-content-section" tabindex="-1"><h2>Product details</h2>${sections.details.map((value) => `<p>${escapeHtml(value)}</p>`).join('')}<dl><div><dt>Brand</dt><dd>${escapeHtml(product.vendor)}</dd></div><div><dt>Product type</dt><dd>${escapeHtml(product.product_type || 'Not supplied')}</dd></div>${product.variants.length > 1 ? `<div><dt>Selected option</dt><dd>${escapeHtml(selected.title)}</dd></div>` : ''}<div><dt>SKU</dt><dd>${escapeHtml(selected.sku || 'Not supplied')}</dd></div></dl></section></details>`,
    `<details><summary>Shipping & returns</summary><section class="product-content-section"><h2>Shipping & returns</h2><p>Production timing, rates, exclusions and returns policy must be configured and approved in Shopify. This local preview makes no delivery-date promise.</p></section></details>`,
  ].filter(Boolean).join('');
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:product.family,href:`#/collection/${slugify(product.family)}`},{label:product.title}])}
    <a class="pdp-back" href="#/collection/${slugify(product.family)}">← Back to results</a>
    ${invalidDeepLink ? `<div class="inline-alert" role="alert">The requested variant is not part of this product. The first available option is shown and clearly selected.</div>` : ''}
    <article class="pdp"><header class="pdp-identity"><h1>${escapeHtml(product.title)}</h1><div class="pdp-meta"><a class="product-brand brand-link" href="#/brand/${slugify(product.vendor)}">${escapeHtml(product.vendor)}</a>${selected.sku ? `<span>SKU ${escapeHtml(selected.sku)}</span>` : ''}${attributes.map((attribute) => `<span class="pdp-attribute">${icon('check')}${escapeHtml(attribute)}</span>`).join('')}</div><div class="pdp-price-block">${priceMarkup(selected)}${unitPrice ? `<small class="unit-price">(${escapeHtml(unitPrice)})</small>` : ''}</div>
        <p class="stock-line ${selected.available_snapshot?'':'sold'}">${selected.available_snapshot ? 'In stock' : 'Out of stock'}</p>
      </header>${gallery}
      <div class="pdp-purchase">
        <form class="product-form" data-product-form data-handle="${escapeHtml(product.handle)}">${variants}
          <div class="pdp-buy-row"><div class="quantity-field"><label for="pdp-quantity">Quantity</label><span class="quantity-stepper"><button type="button" data-pdp-qty="-1" aria-label="Decrease quantity">−</button><input id="pdp-quantity" type="number" name="quantity" value="1" min="1" max="20" inputmode="numeric"><button type="button" data-pdp-qty="1" aria-label="Increase quantity">+</button></span></div><button class="button pdp-add-button" type="submit" ${selected.available_snapshot?'':'disabled'}>${selected.available_snapshot?'Add to cart':'Sold out'}</button><button class="pdp-wishlist" type="button" data-wishlist-preview aria-label="Save ${escapeHtml(product.title)} for later">${icon('heart')}</button></div>
          <p class="form-note">Choose your quantity, then add this exact option to your cart.</p></form>
        ${purchaseReassurance()}
        <div class="mobile-buy-bar" aria-label="Mobile purchase actions"><div><small>${escapeHtml(selected.title === 'Default Title' ? product.vendor : selected.title)}</small>${priceMarkup(selected, { compact: true })}</div><button class="button" type="button" data-mobile-add data-handle="${escapeHtml(product.handle)}" data-variant="${escapeHtml(selected.source_id)}" ${selected.available_snapshot?'':'disabled'}>${selected.available_snapshot?'Add to cart':'Sold out'}</button></div>
        <div class="disclaimer">Source product information is shown for management review. Label wording, claims, warnings and production rights require merchant/qualified approval before launch.</div>
        <div class="product-content pdp-details" aria-label="Product information">${disclosureRows}</div>
      </div></article>
    <div class="pdp-discovery">${pdpProductRail({ id:'pdp-similar', eyebrow:'Same shelf and product type', title:'Similar items', products:discovery.similar, href:`#/collection/${slugify(product.family)}` })}${pdpProductRail({ id:'pdp-more', eyebrow:'More from this department', title:'More products you may like', products:discovery.more, href:`#/collection/${slugify(product.family)}` })}${pdpProductRail({ id:'pdp-together', eyebrow:'Recommendation preview · not purchase-history data', title:'Frequently bought together', products:discovery.together, href:'#/categories' })}</div>
    <dialog class="zoom-dialog" id="media-zoom-dialog" aria-label="Enlarged product image"><button class="icon-button" type="button" data-close-zoom aria-label="Close enlarged image">${icon('close')}</button><img src="/vitamin-express-preview/catalog/${escapeHtml(mediaState.media.local_path)}" alt="${escapeHtml(mediaState.media.alt)}"><p>${escapeHtml(mediaNote)}</p></dialog>`;
}

function cartPage() {
  const lines = cartDetails();
  if (!lines.length) return `${breadcrumbs([{label:'Home',href:'#/'},{label:'Cart'}])}<div class="empty-state"><p class="eyebrow">Your bag</p><h1 class="page-title">Cart is empty</h1><p>Explore vitamins, supplements and everyday wellness essentials.</p><a class="button" href="#/categories">Browse categories</a></div>`;
  const subtotalMinor = lines.reduce((total, line) => total + (moneyMinor(line.variant.price.amount) || 0) * line.quantity, 0);
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:'Cart'}])}<p class="eyebrow">Your order</p><h1 class="page-title">Your cart</h1><p class="lede">Review your items and quantities before checkout.</p>
    <div class="cart-layout section"><div class="cart-list">${lines.map((line) => `<article class="cart-line"><img src="${productImage(line.product)}" alt=""><div><h2><a href="${productHref(line.product, line.variantId)}">${escapeHtml(line.product.title)}</a></h2><span>${escapeHtml(line.variant.title === 'Default Title' ? line.product.vendor : line.variant.title)}</span>${priceMarkup(line.variant, { compact: true })}<div class="qty" aria-label="Quantity for ${escapeHtml(line.product.title)}"><button type="button" data-qty="-1" data-variant="${escapeHtml(line.variantId)}" aria-label="Decrease quantity">−</button><output>${line.quantity}</output><button type="button" data-qty="1" data-variant="${escapeHtml(line.variantId)}" aria-label="Increase quantity">+</button></div> <button class="remove-link" type="button" data-remove-line="${escapeHtml(line.variantId)}">Remove</button></div><strong>${moneyLabel(((moneyMinor(line.variant.price.amount) || 0) * line.quantity) / 100, line.variant.price.currency)}</strong></article>`).join('')}</div>
      <aside class="cart-summary"><h2>Summary</h2>${orderNoteMarkup('page-order-note')}${shippingSummary(subtotalMinor)}<div class="summary-row"><span>Subtotal</span><strong>${moneyLabel(subtotalMinor / 100, lines[0]?.variant.price.currency || 'CAD')}</strong></div><div class="summary-row"><span>Shipping & taxes</span><span>Calculated at checkout</span></div><p>Final shipping, taxes and discounts are shown at checkout.</p><button class="button signal" type="button" data-demo-checkout>Checkout</button><button class="button secondary" type="button" data-reset-cart>Clear cart</button></aside></div>`;
}

function signInPage() {
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:'Sign in'}])}<section class="signin-experience"><div class="signin-panel"><div class="concept-brand"><img src="/vitamin-express-preview/shared/assets/vitamin-express-logo.jpeg" width="640" height="640" alt=""><span>Vitamin Express account</span></div><p class="eyebrow">Secure account preview · not connected</p><h1 class="page-title">Welcome back.</h1><p class="lede">Production sign-in is hosted by Shopify. This local presentation never requests, transmits or stores an email, password, one-time code or social credential.</p><div class="signin-fields" aria-label="Shopify-hosted sign-in fields preview"><div><span>Email or mobile</span><strong>Entered only on the activated Shopify account service</strong></div><div><span>Password or one-time code</span><strong>Protected by the configured account provider</strong></div></div><button class="button signin-primary" type="button" data-demo-signin data-provider="Shopify customer account">Continue to secure sign in</button><div class="signin-divider"><span>or choose an approved provider</span></div><div class="provider-list"><button type="button" data-demo-signin data-provider="Google"><span class="provider-mark">G</span>Continue with Google<span aria-hidden="true">→</span></button><button type="button" data-demo-signin data-provider="Shop"><span class="provider-mark shop">S</span>Continue with Shop<span aria-hidden="true">→</span></button><button type="button" data-demo-signin data-provider="Email code"><span class="provider-mark">@</span>Continue with email code<span aria-hidden="true">→</span></button></div><div class="signin-guest"><span>Not ready to sign in?</span><a href="#/categories">Continue shopping as a guest →</a></div></div><aside class="signin-benefits"><p class="eyebrow">Connected account experience</p><h2>Useful tools, without invented rewards.</h2><p>Only features backed by Shopify or an approved storefront implementation will be activated.</p><div class="signin-benefit-list"><article>${icon('order')}<div><h3>Orders and reorder</h3><p>Review eligible order history and recheck current availability before buying again.</p></div></article><article>${icon('heart')}<div><h3>Saved products</h3><p>A planned convenience feature; no favourites are fabricated in this preview.</p></div></article><article>${icon('shield')}<div><h3>Hosted account security</h3><p>Authentication and recovery remain on the configured Shopify account service.</p></div></article></div><button class="button secondary" type="button" data-demo-signin data-provider="Create account">Preview account creation</button><small>Provider availability and account branding require merchant setup and owner approval.</small></aside></section>`;
}

function accountPage() {
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:'Account preview'}])}<div class="concept-brand"><img src="/vitamin-express-preview/shared/assets/vitamin-express-logo.jpeg" width="640" height="640" alt=""><span>Vitamin Express account</span></div><p class="eyebrow">Guest reviewer view · not connected</p><h1 class="page-title">Account tools, before activation.</h1><p class="lede">This page demonstrates the customer-account structure without inventing a signed-in shopper, order, reward balance or saved item.</p>
    <section class="section concept-grid"><article class="concept-card"><h2>Sign in securely</h2><p>Production will use Shopify-hosted customer accounts. This local preview never requests or stores credentials.</p><a class="button small" href="#/sign-in">Preview sign-in choices</a></article><article class="concept-card"><h2>Orders & reorder</h2><p>After activation, authenticated shoppers can review eligible orders and recheck current price and availability before reordering.</p><span class="status-pill">Requires Shopify Customer Accounts</span></article><article class="concept-card"><h2>Saved items</h2><p>Saved-product behavior and persistence require an approved implementation. No sample favourites are presented as customer data.</p><a href="#/categories">Browse the catalog</a></article><article class="concept-card"><h2>Need help?</h2><p>Customer-service destinations remain visible while verified contact details and service hours await owner approval.</p><a href="#/support">View support planning</a></article></section>`;
}

function aboutPage() {
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:'About'}])}<p class="eyebrow">Company presentation</p><h1 class="page-title">A clearer way to shop wellness.</h1><p class="lede">Vitamin Express is being designed as a product-first Canadian wellness storefront. Final company history, ownership language and public contact details remain owner-supplied content.</p><section class="section concept-grid"><article class="concept-card"><h2>Catalog clarity</h2><p>Exact formats, pack sizes, availability snapshots and source descriptions stay close to the purchase decision.</p></article><article class="concept-card"><h2>Responsible guidance</h2><p>General shopping orientation is separated from medical advice, and label warnings remain visible.</p></article><article class="concept-card"><h2>Local-first validation</h2><p>This management demo is intentionally disconnected from Shopify, checkout, accounts and production systems.</p></article></section>`;
}

function journalPage() {
  const cards = (settings.journal_cards || []).map((card) => ({ ...card, products: card.product_handles.map(findProduct).filter(Boolean).slice(0, 2) })).filter((card) => card.products.length);
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:'Blogs & guides'}])}<p class="eyebrow">Practical guidance</p><h1 class="page-title">Wellness shopping, made readable.</h1><p class="lede">Original product-first guides help shoppers compare formats and labels without giving individualized medical advice.</p><section class="section journal-grid">${cards.map((card) => `<article class="journal-card"><a class="journal-card__media journal-card__media--${escapeHtml(card.tone)}" href="${escapeHtml(card.href)}" aria-label="Read ${escapeHtml(card.title)}">${card.products.map((product) => `<img src="${productImage(product)}" alt="" loading="lazy">`).join('')}</a><div class="journal-card__copy"><p class="eyebrow">${escapeHtml(card.eyebrow)}</p><h2><a href="${escapeHtml(card.href)}">${escapeHtml(card.title)}</a></h2><p>${escapeHtml(card.excerpt)}</p><a href="${escapeHtml(card.href)}">Read guide →</a></div></article>`).join('')}</section>`;
}

function articlePage(slug) {
  const articles = {
    'how-to-read-a-supplement-label': {
      eyebrow: 'Shopping basics · 4 minute read', title: 'How to read a supplement label', intro: 'A product title can look simple, but the useful details are usually spread across the label. These four checkpoints make comparison clearer.',
      sections: [['1. Start with the serving', 'Check whether the displayed amount is per capsule, per scoop or per full serving. A serving may contain more than one unit.'], ['2. Match the exact form', 'Ingredients with similar names are not always interchangeable. Keep the exact label wording visible while comparing products.'], ['3. Check strength and pack count', 'Price comparisons make more sense when the serving size, amount per serving and number of servings are considered together.'], ['4. Read directions and warnings', 'Follow the manufacturer-approved label. If you are pregnant, breastfeeding, taking medication or managing a condition, ask a qualified health professional before use.']],
    },
    'compare-supplement-formats': {
      eyebrow: 'Product choice · 5 minute read', title: 'Capsules, liquids and powders: compare the format', intro: 'The format changes how a product is measured, stored and used. Start with the exact label instead of assuming two formats are equivalent.',
      sections: [['1. Compare the labelled serving', 'A capsule count, liquid volume and powder scoop are different units. Compare the manufacturer-labelled serving and the number of servings in the pack.'], ['2. Keep strength attached to its unit', 'Read whether the stated amount applies to one unit or a complete serving. Do not compare front-label numbers without their units and serving context.'], ['3. Check practical handling', 'Use the label for measuring, storage and preparation instructions. Packaging and accessories can differ by format.'], ['4. Recheck directions and warnings', 'The appropriate choice is individual. Follow the approved label and ask a qualified professional when suitability is uncertain.']],
    },
    'build-a-clearer-pantry-shelf': {
      eyebrow: 'Food & pantry · 4 minute read', title: 'Build a clearer everyday pantry shelf', intro: 'Pantry comparisons become easier when pack size, ingredient lists and storage information remain visible beside the price.',
      sections: [['1. Start with the exact pack', 'Compare the net quantity and package format so a smaller bag or jar is not mistaken for the same offer.'], ['2. Read the complete ingredient list', 'Use the package information for ingredients and allergen statements rather than relying only on a short product title.'], ['3. Check storage instructions', 'Follow the manufacturer’s directions for storage after opening and use the package date information where supplied.'], ['4. Compare price with context', 'A useful comparison keeps the price beside the exact size and format. Final suitability still depends on the shopper’s needs and the approved label.']],
    },
  };
  const article = articles[slug];
  if (!article) return notFoundPage();
  return `<article class="article">${breadcrumbs([{label:'Home',href:'#/'},{label:'Blogs & guides',href:'#/journal'},{label:article.title}])}<p class="eyebrow">${escapeHtml(article.eyebrow)}</p><h1 class="page-title">${escapeHtml(article.title)}</h1><p class="lede">${escapeHtml(article.intro)}</p>${article.sections.map(([heading, body]) => `<h2>${escapeHtml(heading)}</h2><p>${escapeHtml(body)}</p>`).join('')}<div class="article-callout"><strong>This guide is general shopping orientation, not medical advice.</strong> Product claims and substantive health content require qualified review before publication.</div></article>`;
}

function supportPage(kind = 'support') {
  const policy = kind === 'policies';
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:policy?'Policies':'Help'}])}<p class="eyebrow">Presentation concept</p><h1 class="page-title">${policy ? 'Clear policies, before purchase.' : 'Help when it matters.'}</h1><p class="lede">${policy ? 'These are content slots, not approved legal terms.' : 'No form submits in this local demo. Production contact channels and service levels require owner confirmation.'}</p><section class="section concept-grid"><article class="concept-card"><h2>Shipping</h2><p>Show actual regions, carriers, rates, thresholds and exclusions after Shopify settings are approved. Do not promise a delivery date from warehouse location alone.</p></article><article class="concept-card"><h2>Returns</h2><p>State eligibility, time window, unopened-product rules, refund method and the difference between financial refunds and physical returns.</p></article><article class="concept-card"><h2>Contact</h2><p>Owner-provided email, phone, hours and escalation path go here. No placeholder address or unmonitored inbox is presented as real.</p></article></section>`;
}

function qaShoppingPage() {
  const fixtureVariant = (amount, compare) => ({ price: { amount, currency: 'CAD' }, compare_at_price: compare === undefined ? null : { amount: compare, currency: 'CAD' }, available_snapshot: true });
  const priceFixtures = [
    ['Full price', fixtureVariant('19.99')], ['Valid sale', fixtureVariant('14.99','19.99')], ['Equal compare-at', fixtureVariant('19.99','19.99')],
    ['Lower compare-at', fixtureVariant('19.99','18.99')], ['Zero compare-at', fixtureVariant('19.99','0')], ['Malformed compare-at', fixtureVariant('19.99','not-a-price')], ['Tiny saving', fixtureVariant('99.95','100.00')],
  ];
  return `${breadcrumbs([{label:'Home',href:'#/'},{label:'QA shopping fixtures'}])}<p class="eyebrow test-fixture-label">TEST FIXTURE — NOT CATALOG DATA</p><h1 class="page-title">Shopping-state fixtures</h1><p class="lede">Isolated presentation cases for conditions absent from the 65-product snapshot. These controls cannot add products or reach Shopify.</p>
    <section class="section qa-fixtures"><h2>Price validity</h2><div class="fixture-grid">${priceFixtures.map(([label,variant]) => `<article><h3>${escapeHtml(label)}</h3>${priceMarkup(variant)}</article>`).join('')}</div></section>
    <section class="section qa-fixtures"><h2>Combination states</h2><fieldset class="variant-group"><legend>Format: <strong>Capsule</strong></legend><div class="variant-options"><input class="variant-radio" id="fixture-capsule" type="radio" checked><label class="variant-option" for="fixture-capsule"><span>Capsule</span><small>Existing and available</small><b aria-hidden="true">${icon('check')}</b><em>Available</em></label><input class="variant-radio" id="fixture-liquid" type="radio"><label class="variant-option is-sold-out" for="fixture-liquid"><span>Liquid</span><small>Existing selection</small><b aria-hidden="true">${icon('check')}</b><em>Sold out</em></label><input class="variant-radio" id="fixture-powder" type="radio" disabled><label class="variant-option is-unavailable" for="fixture-powder"><span>Powder</span><small>No matching combination</small><b aria-hidden="true">${icon('check')}</b><em>Unavailable</em></label></div></fieldset><label class="bounded-options">High-variant fallback<select><option>Choose from 120 exact combinations</option></select><small>Large sets use a bounded native selector rather than a button dump.</small></label></section>
    <section class="section qa-fixtures"><h2>Sanitized content fallback</h2><p>${escapeHtml('<img src=x onerror="alert(1)"> Supplied markup is rendered as text in the demo fallback.')}</p></section>`;
}

function notFoundPage() {
  return `<div class="empty-state"><p class="eyebrow">404</p><h1 class="page-title">That shelf moved.</h1><p>The page is not part of this local sample. Search the catalog or return to categories.</p><div class="hero-actions" style="justify-content:center"><a class="button" href="#/">Go home</a><a class="button secondary" href="#/categories">Browse categories</a></div></div>`;
}

function settingsDrawer() {
  const families = [...new Set(catalog.products.map((product) => product.family))];
  return `<div class="drawer-backdrop" data-settings-backdrop><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="drawer-head"><div><p class="eyebrow">Local only</p><h2 id="settings-title">Demo settings</h2></div><button class="icon-button" type="button" data-close-settings aria-label="Close settings">${icon('close')}</button></div><p>Preview selected Theme Editor-style choices. Changes stay in this browser and never reach Shopify.</p><form class="settings-form" data-settings-form><label>Hero heading<input class="field" name="heading" value="${escapeHtml(settings.hero.heading)}" maxlength="80"></label><label>Hero message<textarea class="field" name="body" maxlength="260">${escapeHtml(settings.hero.body)}</textarea></label><fieldset><legend>Featured category tiles</legend>${families.map((family) => `<label><input type="checkbox" name="collection" value="${escapeHtml(family)}" ${settings.featured_collections.includes(family)?'checked':''}>${escapeHtml(family)}</label>`).join('')}</fieldset><button class="button" type="submit">Apply locally</button><button class="button secondary" type="button" data-reset-settings>Reset demo settings</button></form></aside></div>`;
}

function render() {
  locationRequest?.abort();
  document.body.classList.remove('filters-open');
  megaPinned = false;
  const { path, params } = parseRoute();
  const parts = path.split('/').filter(Boolean);
  let content;
  if (!parts.length) content = homePage();
  else if (parts[0] === 'categories') content = categoriesPage();
  else if (parts[0] === 'deals') content = dealsPage(params);
  else if (parts[0] === 'kids-family') content = kidsFamilyPage(params);
  else if (parts[0] === 'collection' && parts[1]) content = collectionPage(parts[1], params);
  else if (parts[0] === 'search') content = searchPage(params);
  else if (parts[0] === 'brands' && !parts[1] && params.get('canadian') === '1') content = canadianOwnedPage(params);
  else if (parts[0] === 'brands' && !parts[1]) content = brandsPage();
  else if (parts[0] === 'canadian-owned') content = canadianOwnedPage(params);
  else if (parts[0] === 'brand' && parts[1]) content = brandPage(parts[1], params);
  else if (parts[0] === 'product' && parts[1]) content = productPage(parts.slice(1).join('/'), params);
  else if (parts[0] === 'cart') content = cartPage();
  else if (parts[0] === 'sign-in') content = signInPage();
  else if (parts[0] === 'account') content = accountPage();
  else if (parts[0] === 'about') content = aboutPage();
  else if (parts[0] === 'journal') content = journalPage();
  else if (parts[0] === 'article' && parts[1]) content = articlePage(parts[1]);
  else if (parts[0] === 'support') content = supportPage();
  else if (parts[0] === 'policies') content = supportPage('policies');
  else if (parts[0] === 'qa-shopping') content = qaShoppingPage();
  else content = notFoundPage();
  app.innerHTML = shell(content);
  if (parts[0] === 'product' && getLocale() === 'fr-CA') {
    const content = document.querySelector('.pdp-details');
    if (content) content.insertAdjacentHTML('afterbegin', '<p class="source-language-note">Manufacturer content is currently available in English.</p>');
  }
  document.documentElement.lang = getLocale();
  localize(app);
  syncComparison();
  document.querySelector('.skip-link').textContent = t('Skip to content');
  render.lastUrl = location.href;
  document.title = `${parts.length ? (document.querySelector('h1')?.textContent || 'Storefront') : 'Vitamin Express'} — Vitamin Express Canada`;
  purchaseObserver?.disconnect();
  const purchaseForm = document.querySelector('[data-product-form]');
  const mobileBuyBar = document.querySelector('.mobile-buy-bar');
  if (purchaseForm && mobileBuyBar) {
    purchaseObserver = new IntersectionObserver(([entry]) => {
      const formHasPassed = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
      mobileBuyBar.classList.toggle('visible', formHasPassed);
    });
    purchaseObserver.observe(purchaseForm);
  }
  const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}')[location.hash || '#/'];
  requestAnimationFrame(() => {
    scrollTo({ top: saved || 0, behavior: 'instant' });
    updateCompactHeader();
    updateHeaderFit();
    setupHeroCarousel();
    setupBrandCarousel();
    setupOfferCountdown();
    document.querySelectorAll('[data-rail-id]').forEach((button) => syncRailButtons(button.dataset.railId));
    if (pendingCartDrawer) {
      pendingCartDrawer = false;
      openCartDrawer(null);
    }
  });
}

function updateParams(mutator, { preserveScroll = false } = {}) {
  const { path, params } = parseRoute();
  mutator(params);
  const query = params.toString();
  const hash = `#${path}${query ? `?${query}` : ''}`;
  if (preserveScroll) {
    const scroll = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}');
    scroll[hash] = scrollY;
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scroll));
    history.pushState(null, '', hash);
    previousHash = hash;
    render();
  } else location.hash = hash;
}

function changeLanguage(nextLocale, nextCurrency = getPreferences().currency) {
  if (!setLocale(nextLocale)) return;
  setCurrency(nextCurrency);
  const search = document.querySelector('#site-search')?.value || '';
  const scope = document.querySelector('#search-scope')?.value || '';
  const quantity = document.querySelector('#pdp-quantity')?.value;
  const activeSlide = Number(document.querySelector('[data-hero-carousel]')?.dataset.activeSlide || 0);
  const top = scrollY;
  closeLocalization();
  document.body.classList.remove('drawer-open');
  render();
  document.querySelector('#site-search').value = search;
  document.querySelector('#search-scope').value = scope;
  if (quantity) document.querySelector('#pdp-quantity').value = quantity;
  requestAnimationFrame(() => {
    scrollTo({ top, behavior: 'instant' });
    updateCompactHeader();
    if (activeSlide) moveHeroSlide(activeSlide);
    document.querySelector(`[data-language="${getLocale()}"]`)?.focus({ preventScroll: true });
  });
  showToast('Preferences updated.');
}

function updateVariantParam(variantId) {
  const quantity = document.querySelector('#pdp-quantity')?.value || '1';
  const { path, params } = parseRoute();
  params.set('variant', variantId);
  const nextHash = `#${path}?${params.toString()}`;
  const scroll = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}');
  scroll[nextHash] = scrollY;
  sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scroll));
  history.pushState(null, '', nextHash);
  previousHash = nextHash;
  render();
  document.querySelector('#pdp-quantity').value = quantity;
  requestAnimationFrame(() => {
    document.querySelector('[data-variant-option]:checked')?.focus({ preventScroll: true });
    const status = document.querySelector('[data-variant-status]');
    if (status) status.textContent = `${document.querySelector('.variant-group strong').textContent} · ${document.querySelector('.pdp-price-block .current-price').textContent}`;
  });
}

function queueMutation(button, operation) {
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.dataset.originalLabel = button.textContent;
    if (button.matches('[data-add],[data-mobile-add],[type="submit"]')) button.textContent = t('Adding…');
  }
  mutationQueue = mutationQueue.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    operation();
    if (!getCart().length) saveOrderNote('');
    render();
  }).catch(() => showToast('The local cart could not be updated.', 'error')).finally(() => { if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = button.dataset.originalLabel || button.textContent; } });
}

app.addEventListener('submit', (event) => {
  if (event.target.matches('[data-price-range]')) {
    event.preventDefault();
    const form = event.target;
    const min = Number(form.elements.min.value);
    const max = Number(form.elements.max.value);
    if (min > max) { form.elements.max.setCustomValidity(t('Maximum price must be at least the minimum price.')); form.reportValidity(); return; }
    updateParams(params => {
      params.delete('price');
      params.set('min', (min / Number(form.dataset.rate)).toFixed(6));
      params.set('max', (max / Number(form.dataset.rate)).toFixed(6));
    }, { preserveScroll: !matchMedia('(max-width: 700px)').matches });
    return;
  }
  if (event.target.matches('[data-delivery-form]')) {
    event.preventDefault();
    const form = event.target;
    if (!setDestination(form.elements.country.value, form.elements.postal.value)) {
      form.elements.postal.setAttribute('aria-invalid', 'true');
      form.querySelector('[role="status"]').textContent = t('Enter a valid postal / ZIP code for the selected country.');
      form.elements.postal.focus();
      return;
    }
    commitDeliveryPreferences();
    return;
  }
  if (event.target.matches('[data-search-form]')) {
    event.preventDefault(); const data = new FormData(event.target); const query = data.get('q').trim(); const scope = data.get('scope'); location.hash = `/search?q=${encodeURIComponent(query)}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}`;
  }
  if (event.target.matches('[data-product-form]')) {
    event.preventDefault(); const data = new FormData(event.target); const product = findProduct(event.target.dataset.handle); const variantId = data.get('variant') || product.variants[0].source_id; const quantity = Math.max(1, Math.min(20, Number(data.get('quantity')) || 1));
    queueMutation(event.submitter, () => addToCart(product.handle, variantId, quantity));
  }
  if (event.target.matches('[data-settings-form]')) {
    event.preventDefault(); const data = new FormData(event.target); const collections = data.getAll('collection'); settings = { ...settings, hero: { ...settings.hero, heading: data.get('heading').trim(), body: data.get('body').trim() }, featured_collections: collections }; localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); closeSettings(); render(); showToast('Demo settings applied locally.');
  }
});

function addToCart(handle, variantId, quantity = 1) {
  const product = findProduct(handle); const variant = product?.variants.find((item) => item.source_id === variantId);
  if (!product || !variant?.available_snapshot) { showToast('That sample variant is not available.', 'error'); return false; }
  const cart = getCart(); const line = cart.find((item) => item.variantId === variantId);
  if (line) line.quantity = Math.min(20, line.quantity + quantity); else cart.push({ handle, variantId, quantity });
  saveCart(cart); pendingCartDrawer = true; showToast(`${product.title} added to the local cart.`); return true;
}

function closeOtherDialogs(except = null) {
  document.querySelectorAll('dialog[open]').forEach((item) => { if (item !== except) item.close(); });
  closeSettings();
}

function openCartDrawer(opener = document.activeElement) {
  const drawer = document.querySelector('#cart-drawer');
  if (!drawer || drawer.open) return;
  closeOtherDialogs(drawer);
  cartDrawerOpener = opener;
  drawer.showModal();
  document.body.classList.add('drawer-open');
  drawer.querySelector('[data-close-cart]')?.focus();
}

function closeCartDrawer({ restore = true } = {}) {
  const drawer = document.querySelector('#cart-drawer');
  if (drawer?.open) drawer.close();
  document.body.classList.remove('drawer-open');
  if (restore && cartDrawerOpener?.isConnected) cartDrawerOpener.focus();
}

function openZoom(opener) {
  const modal = document.querySelector('#media-zoom-dialog');
  if (!modal || modal.open) return;
  closeOtherDialogs(modal);
  zoomOpener = opener;
  const source = opener?.dataset.zoomSrc;
  if (source) modal.querySelector('img')?.setAttribute('src', source);
  modal.showModal();
  document.body.classList.add('drawer-open');
  modal.querySelector('[data-close-zoom]')?.focus();
}

function closeZoom({ restore = true } = {}) {
  const modal = document.querySelector('#media-zoom-dialog');
  if (modal?.open) modal.close();
  document.body.classList.remove('drawer-open');
  if (restore && zoomOpener?.isConnected) zoomOpener.focus();
}

function openChat(opener) {
  const modal = document.querySelector('#chat-preview');
  if (!modal || modal.open) return;
  closeOtherDialogs(modal);
  chatOpener = opener;
  modal.showModal();
  document.body.classList.add('drawer-open');
  modal.querySelector('[data-close-chat]')?.focus();
}

function closeChat({ restore = true } = {}) {
  const modal = document.querySelector('#chat-preview');
  if (modal?.open) modal.close();
  document.body.classList.remove('drawer-open');
  if (restore && chatOpener?.isConnected) chatOpener.focus();
}

function openAccount(opener) {
  const modal = document.querySelector('#account-preview');
  if (!modal || modal.open) return;
  closeOtherDialogs(modal);
  accountOpener = opener;
  modal.style.setProperty('--account-top', `${Math.max(8, Math.round(opener.getBoundingClientRect().bottom + 8))}px`);
  modal.showModal();
  document.body.classList.add('drawer-open');
  modal.querySelector('[data-close-account]')?.focus();
}

function closeAccount({ restore = true } = {}) {
  const modal = document.querySelector('#account-preview');
  if (modal?.open) modal.close();
  document.body.classList.remove('drawer-open');
  if (restore && accountOpener?.isConnected) accountOpener.focus();
}

function openLocalization(opener) {
  const modal = document.querySelector('#localization-preview');
  if (!modal || modal.open) return;
  closeOtherDialogs(modal);
  localizationOpener = opener;
  modal.showModal();
  document.querySelectorAll('[data-open-localization]').forEach(button => button.setAttribute('aria-expanded', 'true'));
  document.body.classList.add('drawer-open');
  // Keep mobile browsers from opening a native picker as the dialog appears.
  modal.querySelector('[value="cancel"]')?.focus({ preventScroll: true });
}

function closeLocalization({ restore = true } = {}) {
  const modal = document.querySelector('#localization-preview');
  if (modal?.open) modal.close();
  document.body.classList.remove('drawer-open');
  if (restore && localizationOpener?.isConnected) localizationOpener.focus();
  document.querySelectorAll('[data-open-localization]').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function openDelivery(opener) {
  const modal = document.querySelector('#delivery-preview');
  deliveryReturnToCart = Boolean(document.querySelector('#cart-drawer')?.open);
  deliveryOpener = opener;
  closeOtherDialogs(modal);
  modal.showModal();
  document.body.classList.add('drawer-open');
  modal.querySelector('[name="postal"]').focus();
}

function commitDeliveryPreferences() {
  locationRequest?.abort();
  const reopenCart = deliveryReturnToCart;
  deliveryReturnToCart = false;
  const top = scrollY;
  pendingCartDrawer = reopenCart;
  document.body.classList.remove('drawer-open');
  render();
  requestAnimationFrame(() => {
    scrollTo({ top, behavior: 'instant' });
    updateCompactHeader();
    if (!reopenCart) document.querySelector('[data-open-delivery]')?.focus({ preventScroll: true });
  });
  showToast('Delivery preference saved in this browser.');
}

async function locateDelivery(button) {
  const form = button.closest('form');
  const status = form.querySelector('[role="status"]');
  locationRequest?.abort();
  const request = new AbortController();
  locationRequest = request;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  status.textContent = t('Finding your area…');
  try {
    const destination = await detectDestination(settings.delivery_preview, { signal: request.signal });
    if (request.signal.aborted || !form.isConnected) return;
    form.elements.country.value = destination.country;
    form.elements.postal.value = destination.postal;
    form.elements.postal.removeAttribute('aria-invalid');
    status.textContent = t('Location found. Check the postal code, then save.');
  } catch (error) {
    if (request.signal.aborted || !form.isConnected) return;
    status.textContent = t(error.code === 1 ? 'Location permission was declined. You can enter your postal code instead.' : error.message?.includes('postal') ? error.message : 'Location is unavailable. Please enter your postal code.');
  } finally {
    if (form.isConnected && !request.signal.aborted) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      form.elements.postal.focus();
    }
  }
}

function updateOrderNote(value) {
  const persisted = saveOrderNote(value);
  document.querySelectorAll('[data-note-indicator]').forEach(label => { label.textContent = t(getOrderNote() ? 'Added' : 'Optional'); });
  document.querySelectorAll('[data-order-note]').forEach(input => { if (input.value !== getOrderNote()) input.value = getOrderNote(); });
  document.querySelectorAll('[data-note-status]').forEach(status => { status.textContent = t(persisted ? 'Saved in this browser only · not sent to our team yet.' : 'Kept for this visit only. Browser storage is unavailable.'); });
}

function closeSettings() {
  document.querySelector('[data-settings-backdrop]')?.classList.remove('open'); document.body.classList.remove('drawer-open');
  if (settingsOpener?.isConnected) settingsOpener.focus();
}

app.addEventListener('click', (event) => {
  const compareDialog = document.querySelector('#product-comparison');
  if (event.target.closest('[data-open-comparison]')) {
    compareDialog.innerHTML = comparisonMarkup();
    localize(compareDialog);
    compareDialog.showModal();
    compareDialog.querySelector('[data-close-comparison]').focus({preventScroll:true});
    document.body.classList.add('drawer-open');
  }
  if (event.target.closest('[data-close-comparison]') || event.target === compareDialog) compareDialog.close();
  if (event.target.closest('#product-comparison a')) {
    compareDialog.close();
    document.body.classList.remove('drawer-open');
  }
  const removeComparison = event.target.closest('[data-remove-comparison]');
  if (removeComparison || event.target.closest('[data-clear-comparison]')) {
    comparedHandles = removeComparison ? comparedHandles.filter(handle => handle !== removeComparison.dataset.removeComparison) : [];
    syncComparison();
  }
  if (event.target.closest('[data-reset-price]')) updateParams(params => { params.delete('min'); params.delete('max'); params.delete('price'); }, {preserveScroll: !matchMedia('(max-width: 700px)').matches});
  const deliveryTrigger = event.target.closest('[data-open-delivery]');
  if (deliveryTrigger) { openDelivery(deliveryTrigger); return; }
  if (event.target.closest('[data-close-delivery]')) { document.querySelector('#delivery-preview').close(); return; }
  if (event.target.closest('[data-clear-destination]')) { clearDestination(); commitDeliveryPreferences(); return; }
  const detectButton = event.target.closest('[data-detect-location]');
  if (detectButton) { locateDelivery(detectButton); return; }
  if (event.target.closest('[data-clear-note]')) { updateOrderNote(''); return; }
  const languageButton = event.target.closest('[data-language]');
  if (languageButton) { changeLanguage(languageButton.dataset.language); return; }
  const flashDismiss = event.target.closest('[data-dismiss-flash]');
  if (flashDismiss) {
    try { localStorage.setItem(FLASH_DISMISS_KEY, String(Date.now() + FLASH_DISMISS_MS)); } catch { /* Close still works for this render. */ }
    flashDismiss.closest('.flash-sale-bar')?.remove();
    showToast('Flash sale banner hidden for 24 hours in this browser.');
  }
  const clearBrandSearch = event.target.closest('[data-clear-brand-search]');
  if (clearBrandSearch) {
    const input = document.querySelector('[data-brand-search]');
    if (input) { input.value = ''; filterBrandDirectory(); input.focus(); }
  }
  const brandJump = event.target.closest('[data-brand-jump]');
  if (brandJump && !brandJump.disabled) {
    const target = brandJump.dataset.brandJump === '#' ? document.querySelector('[data-brand-directory]') : document.querySelector(`[data-brand-letter="${brandJump.dataset.brandJump}"]`);
    target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    target?.querySelector('a')?.focus({ preventScroll: true });
  }
  const cartTrigger = event.target.closest('[data-cart-trigger]');
  if (cartTrigger) { event.preventDefault(); openCartDrawer(cartTrigger); }
  if (event.target.closest('[data-close-cart]') || event.target.matches('#cart-drawer')) closeCartDrawer();
  const zoomTrigger = event.target.closest('[data-open-zoom]');
  if (zoomTrigger) openZoom(zoomTrigger);
  if (event.target.closest('[data-close-zoom]') || event.target.matches('#media-zoom-dialog')) closeZoom();
  const chatTrigger = event.target.closest('[data-open-chat]');
  if (chatTrigger) openChat(chatTrigger);
  if (event.target.closest('[data-close-chat]') || event.target.matches('#chat-preview')) closeChat();
  const accountTrigger = event.target.closest('[data-open-account]');
  if (accountTrigger) openAccount(accountTrigger);
  if (event.target.closest('[data-close-account]') || event.target.matches('#account-preview')) closeAccount();
  const localizationTrigger = event.target.closest('[data-open-localization]');
  if (localizationTrigger) openLocalization(localizationTrigger);
  if (event.target.matches('#localization-preview')) closeLocalization();
  if (event.target.closest('[data-apply-localization]')) { const form = document.querySelector('#localization-preview form'); changeLanguage(form.elements.locale.value, form.elements.currency.value); return; }
  const galleryButton = event.target.closest('[data-gallery-image]');
  if (galleryButton) {
    const mainButton = document.querySelector('[data-open-zoom]');
    const mainImage = mainButton?.querySelector('img');
    if (mainImage) mainImage.src = galleryButton.dataset.galleryImage;
    if (mainButton) mainButton.dataset.zoomSrc = galleryButton.dataset.galleryImage;
    document.querySelectorAll('[data-gallery-image]').forEach((button) => button.setAttribute('aria-current', String(button === galleryButton)));
  }
  const megaTrigger = event.target.closest('[data-mega-trigger]');
  if (megaTrigger) {
    const menu = document.querySelector('[data-mega-menu]');
    const sameOpenMenu = !menu?.hidden && menu.dataset.activeKey === megaTrigger.dataset.megaKey;
    if (megaPinned && sameOpenMenu) { megaPinned = false; closeMega(); }
    else { megaPinned = true; openMega({ trigger: megaTrigger }); }
  }
  else if (!event.target.closest('[data-mega-menu]')) { megaPinned = false; closeMega(); }
  const heroDot = event.target.closest('[data-hero-dot]');
  if (heroDot) moveHeroSlide(Number(heroDot.dataset.heroDot));
  if (event.target.closest('[data-hero-prev]')) { const carousel = document.querySelector('[data-hero-carousel]'); moveHeroSlide(Number(carousel?.dataset.activeSlide || 0) - 1); }
  if (event.target.closest('[data-hero-next]')) { const carousel = document.querySelector('[data-hero-carousel]'); moveHeroSlide(Number(carousel?.dataset.activeSlide || 0) + 1); }
  const dealsTab = event.target.closest('[data-deals-tab]');
  if (dealsTab) selectDealsTab(dealsTab.dataset.dealsTab);
  const railButton = event.target.closest('[data-rail-button]');
  if (railButton) {
    const rail = document.getElementById(railButton.dataset.railId);
    const amount = Math.max(rail?.clientWidth * .86 || 0, 280);
    rail?.scrollBy({ left: railButton.dataset.railButton === 'next' ? amount : -amount, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  const productQuantityButton = event.target.closest('[data-pdp-qty]');
  if (productQuantityButton) {
    const input = productQuantityButton.closest('.quantity-stepper')?.querySelector('input[name="quantity"]');
    if (input) {
      const next = Math.max(Number(input.min) || 1, Math.min(Number(input.max) || 20, (Number(input.value) || 1) + Number(productQuantityButton.dataset.pdpQty)));
      input.value = String(next);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  if (event.target.closest('[data-wishlist-preview]')) showInfo('Save for later requires activation', 'The control is positioned and keyboard accessible, but no product is saved in this disconnected demo. An approved customer-account or wishlist implementation is required before launch.');
  const add = event.target.closest('[data-add]');
  if (add) queueMutation(add, () => addToCart(add.dataset.handle, add.dataset.variant));
  const mobileAdd = event.target.closest('[data-mobile-add]');
  if (mobileAdd) {
    const quantity = Math.max(1, Math.min(20, Number(document.querySelector('[data-product-form] [name="quantity"]')?.value) || 1));
    queueMutation(mobileAdd, () => addToCart(mobileAdd.dataset.handle, mobileAdd.dataset.variant, quantity));
  }
  if (event.target.closest('[data-open-settings]')) { settingsOpener = event.target.closest('[data-open-settings]'); document.querySelector('[data-settings-backdrop]').classList.add('open'); document.body.classList.add('drawer-open'); document.querySelector('[data-close-settings]').focus(); }
  if (event.target.closest('[data-close-settings]') || (event.target.matches('[data-settings-backdrop]'))) closeSettings();
  if (event.target.closest('[data-reset-settings]')) { localStorage.removeItem(SETTINGS_KEY); settings = structuredClone(defaults); closeSettings(); render(); showToast('Demo settings reset.'); }
  if (event.target.closest('[data-mobile-menu]')) showInfo('Browse Vitamin Express', 'Open a shelf or go directly to a common destination.', '<nav class="mobile-menu-panel" aria-label="Mobile navigation"><details open><summary>Shop supplements</summary><a href="#/collection/vitamins">Vitamins</a><a href="#/collection/minerals">Minerals</a><a href="#/collection/digestive-and-gut-health">Digestive wellness</a><a href="#/collection/everyday-wellness">Everyday wellness</a></details><details><summary>More departments</summary><a href="#/collection/sports-nutrition">Sports nutrition</a><a href="#/collection/beauty-and-personal-care">Personal care</a><a href="#/collection/food-and-healthy-living">Food & healthy living</a></details><a href="#/categories">All categories</a><a href="#/brands">Brands A–Z</a><a href="#/journal">Wellness reading</a><a href="#/account">Account concept</a></nav>');
  if (event.target.closest('[data-close-dialog]')) dialog.close();
  if (event.target.closest('[data-demo-checkout]')) showInfo('Checkout stays on Shopify', 'In production this button follows the native Shopify checkout route. The local preview cannot collect payment, create an order, calculate final shipping/tax, or report success.');
  const provider = event.target.closest('[data-demo-signin]');
  if (provider) showInfo(`${provider.dataset.provider} sign-in preview`, `${provider.dataset.provider} is shown as an interface preview only. Shopify Customer Accounts and eligible identity providers require merchant configuration. No credential, code or account data is collected here.`);
  if (event.target.closest('[data-reset-cart]')) queueMutation(event.target, () => { localStorage.removeItem(CART_KEY); showToast('Demo cart reset.'); });
  const qty = event.target.closest('[data-qty]');
  if (qty) { pendingCartDrawer = Boolean(qty.closest('#cart-drawer')); queueMutation(qty, () => { const cart = getCart(); const line = cart.find((item) => item.variantId === qty.dataset.variant); if (!line) return; line.quantity = Math.max(0, Math.min(20, line.quantity + Number(qty.dataset.qty))); saveCart(cart.filter((item) => item.quantity > 0)); }); }
  const remove = event.target.closest('[data-remove-line]');
  if (remove) { pendingCartDrawer = Boolean(remove.closest('#cart-drawer')); queueMutation(remove, () => saveCart(getCart().filter((item) => item.variantId !== remove.dataset.removeLine))); }
  if (event.target.closest('[data-toggle-filters]')) {
    const panel = document.querySelector('.filter-panel');
    const visible = panel?.classList.toggle('mobile-visible') || false;
    document.body.classList.toggle('filters-open', visible);
    document.querySelectorAll('[data-toggle-filters][aria-expanded]').forEach((button) => button.setAttribute('aria-expanded', String(visible)));
    if (visible) panel.querySelector('[data-toggle-filters]')?.focus();
  }
  if (event.target.closest('[data-clear-filters]')) {
    const { path, params } = parseRoute();
    const keep = new URLSearchParams();
    if (params.get('q')) keep.set('q', params.get('q'));
    if (params.get('scope')) keep.set('scope', params.get('scope'));
    location.hash = `${path}${keep.toString() ? `?${keep}` : ''}`;
  }
  const removeFacet = event.target.closest('[data-remove-facet]');
  if (removeFacet) updateParams((params) => {
    const key = removeFacet.dataset.param;
    const value = removeFacet.dataset.value;
    if (key === 'range') { params.delete('min'); params.delete('max'); }
    else if (['price', 'available'].includes(key)) params.delete(key);
    else {
      const keep = params.getAll(key).filter((item) => item !== value);
      params.delete(key);
      keep.forEach((item) => params.append(key, item));
    }
  });
});

app.addEventListener('input', (event) => {
  if (event.target.matches('[data-price-range] input')) updatePriceInputs(event.target);
  if (event.target.matches('[data-order-note]')) updateOrderNote(event.target.value);
  if (event.target.matches('[data-delivery-form] input')) {
    locationRequest?.abort();
    const form = event.target.closest('form');
    form.querySelector('[data-detect-location]').disabled = false;
    form.querySelector('[data-detect-location]').removeAttribute('aria-busy');
    event.target.removeAttribute('aria-invalid');
    form.querySelector('[role="status"]').textContent = '';
  }
  if (event.target.matches('[data-brand-search]')) { filterBrandDirectory(event.target.value); return; }
  if (!event.target.matches('#site-search')) return;
  clearTimeout(autocompleteTimer);
  autocompleteTimer = setTimeout(() => updateAutocomplete(event.target), 120);
});

app.addEventListener('pointerover', (event) => {
  const hoverItem = event.target.closest('[data-mega-hover]');
  const megaTrigger = hoverItem?.querySelector('[data-mega-trigger]') || event.target.closest('[data-mega-trigger]');
  if (megaTrigger && (!hoverItem || !hoverItem.contains(event.relatedTarget))) {
    clearTimeout(openMega.timer);
    clearTimeout(megaHoverTimer);
    megaHoverTimer = setTimeout(() => openMega({ trigger: megaTrigger }), MEGA_HOVER_INTENT_MS);
  } else if (event.target.closest('[data-mega-menu]')) {
    clearTimeout(openMega.timer);
    clearTimeout(megaHoverTimer);
  }
});

app.addEventListener('pointerout', (event) => {
  const hoverItem = event.target.closest('[data-mega-hover]');
  if (hoverItem && !hoverItem.contains(event.relatedTarget)) clearTimeout(megaHoverTimer);
  if (event.target.closest('[data-mega-hover],[data-mega-menu]') && !event.relatedTarget?.closest?.('[data-mega-hover],[data-mega-menu]') && !megaPinned) openMega.timer = setTimeout(() => closeMega(), 220);
});

app.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' && event.target.closest('[data-hero-carousel]')) heroTouchStartX = event.clientX;
});

app.addEventListener('pointerup', (event) => {
  if (heroTouchStartX === null || !event.target.closest('[data-hero-carousel]')) return;
  const delta = event.clientX - heroTouchStartX;
  heroTouchStartX = null;
  if (Math.abs(delta) < 44) return;
  const carousel = document.querySelector('[data-hero-carousel]');
  moveHeroSlide(Number(carousel?.dataset.activeSlide || 0) + (delta < 0 ? 1 : -1));
});

app.addEventListener('scroll', (event) => {
  if (event.target.matches('.product-rail__track,.deals-panel__track,.discovery-row')) syncRailButtons(event.target.id);
}, true);

app.addEventListener('focusin', (event) => {
  if (event.target.matches('#site-search') && event.target.value.trim().length >= 2) updateAutocomplete(event.target);
  const megaTrigger = event.target.matches('[data-mega-link]') ? event.target.closest('[data-mega-hover]')?.querySelector('[data-mega-trigger]') : event.target.closest('[data-mega-trigger]');
  if (megaTrigger && !suppressMegaFocusOpen) openMega({ trigger: megaTrigger });
  if (event.target.closest('[data-hero-carousel]')) stopHeroAutoplay();
});

app.addEventListener('focusout', (event) => {
  if (event.target.closest('[data-search-form]')) setTimeout(() => {
    if (!document.activeElement?.closest('[data-search-form]')) closeAutocomplete();
  }, 0);
  if (event.target.closest('[data-hero-carousel]')) setTimeout(() => { if (!document.activeElement?.closest('[data-hero-carousel]')) startHeroAutoplay(); }, 0);
});

app.addEventListener('keydown', (event) => {
  if (event.target.matches('[data-mega-trigger],[data-mega-link]') && event.key === 'ArrowDown') { event.preventDefault(); const trigger = event.target.matches('[data-mega-trigger]') ? event.target : event.target.closest('[data-mega-hover]')?.querySelector('[data-mega-trigger]'); openMega({ trigger, focusFirst: true }); return; }
  const dealTab = event.target.closest('[data-deals-tab]');
  if (dealTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const tabs = [...dealTab.closest('[role="tablist"]').querySelectorAll('[data-deals-tab]')];
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : tabs.indexOf(dealTab) + (event.key === 'ArrowRight' ? 1 : -1);
    next = (next + tabs.length) % tabs.length;
    selectDealsTab(tabs[next].dataset.dealsTab, { focus: true });
    return;
  }
  if (event.key === 'Escape' && (event.target.closest('[data-mega-menu]') || event.target.matches('[data-mega-trigger],[data-mega-link]'))) { event.preventDefault(); megaPinned = false; closeMega({ returnFocus: true }); return; }
  if (event.target.matches('#site-search') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    const options = [...event.target.closest('[data-search-form]').querySelectorAll('[role="option"]')];
    if (!options.length) return;
    event.preventDefault(); options[event.key === 'ArrowDown' ? 0 : options.length - 1].focus(); return;
  }
  if (event.target.matches('[role="option"]') && ['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) {
    event.preventDefault();
    const form = event.target.closest('[data-search-form]'); const input = form.querySelector('#site-search');
    if (event.key === 'Escape') { closeAutocomplete(input); input.focus(); return; }
    const options = [...form.querySelectorAll('[role="option"]')]; const index = options.indexOf(event.target); const delta = event.key === 'ArrowDown' ? 1 : -1; options[(index + delta + options.length) % options.length].focus();
  }
});

dialog.addEventListener('close', () => { if (dialogOpener?.isConnected) dialogOpener.focus(); });
dialog.addEventListener('click', (event) => { if (event.target.closest('[data-close-dialog]') || event.target === dialog) dialog.close(); });

app.addEventListener('close', (event) => {
  document.body.classList.toggle('drawer-open', Boolean(document.querySelector('dialog[open]')));
  if (event.target.id === 'delivery-preview') {
    locationRequest?.abort();
    const detect = event.target.querySelector('[data-detect-location]');
    detect.disabled = false;
    detect.removeAttribute('aria-busy');
    if (deliveryReturnToCart) { deliveryReturnToCart = false; openCartDrawer(cartDrawerOpener); }
    else if (deliveryOpener?.isConnected) deliveryOpener.focus({ preventScroll: true });
  }
  if (event.target.id === 'localization-preview') document.querySelectorAll('[data-open-localization]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  if (event.target.id === 'cart-drawer' && cartDrawerOpener?.isConnected) cartDrawerOpener.focus();
  if (event.target.id === 'media-zoom-dialog' && zoomOpener?.isConnected) zoomOpener.focus();
  if (event.target.id === 'chat-preview' && chatOpener?.isConnected) chatOpener.focus();
  if (event.target.id === 'account-preview' && accountOpener?.isConnected) accountOpener.focus();
  if (event.target.id === 'localization-preview' && localizationOpener?.isConnected) localizationOpener.focus();
}, true);

app.addEventListener('change', (event) => {
  if (event.target.matches('[data-compare-product]')) {
    const handle = event.target.dataset.compareProduct;
    comparedHandles = comparedHandles.filter(item => item !== handle);
    if (event.target.checked && comparedHandles.length < 3) comparedHandles.push(handle);
    syncComparison();
  }
  if (event.target.matches('[data-compare-variant]')) {
    const handle = event.target.dataset.compareVariant;
    comparedVariants.set(handle, event.target.value);
    const modal = event.target.closest('dialog');
    const left = modal.querySelector('.comparison-scroll').scrollLeft;
    modal.innerHTML = comparisonMarkup();
    localize(modal);
    modal.querySelector(`[data-compare-variant="${handle}"]`).focus({preventScroll:true});
    modal.querySelector('.comparison-scroll').scrollLeft = left;
  }
  if (event.target.matches('[data-delivery-form] select')) {
    locationRequest?.abort();
    const form = event.target.closest('form');
    form.querySelector('[data-detect-location]').disabled = false;
    form.querySelector('[data-detect-location]').removeAttribute('aria-busy');
    form.elements.postal.removeAttribute('aria-invalid');
    form.querySelector('[role="status"]').textContent = '';
    form.elements.postal.placeholder = event.target.value === 'CA' ? 'M5V 2T6' : event.target.value === 'US' ? '10001' : t('Postal / ZIP code');
  }
  if (event.target.matches('#search-scope')) { const input = document.querySelector('#site-search'); if (input?.value.trim().length >= 2) updateAutocomplete(input); }
  if (event.target.matches('[data-sort]')) updateParams((params) => params.set('sort', event.target.value));
  if (event.target.matches('[data-facet]')) updateParams((params) => { const key = event.target.dataset.param; const values = [...document.querySelectorAll(`[data-facet][data-param="${key}"]:checked`)].map((input) => input.value); params.delete(key); values.forEach((value) => params.append(key, value)); });
  if (event.target.matches('[data-price]')) updateParams((params) => event.target.value ? params.set('price', event.target.value) : params.delete('price'));
  if (event.target.matches('[data-available]')) updateParams((params) => event.target.checked ? params.set('available','1') : params.delete('available'));
  if (event.target.matches('[data-variant-option]')) updateVariantParam(event.target.value);
});

function handleNavigation() {
  if (render.lastUrl === location.href) return;
  const language = new URLSearchParams(location.search).get('lang');
  if (language === 'en' || language === 'fr') setLocale(language === 'fr' ? 'fr-CA' : 'en-CA');
  const scroll = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}'); scroll[previousHash] = scrollY; sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scroll)); previousHash = location.hash || '#/'; render();
}
window.addEventListener('hashchange', handleNavigation);
window.addEventListener('popstate', handleNavigation);
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeSettings(); closeAutocomplete(); } });
window.addEventListener('scroll', updateCompactHeader, { passive: true });
window.addEventListener('resize', updateHeaderFit, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopHeroAutoplay(); else startHeroAutoplay(); });

window.__veShoppingTest = { moneyMinor, priceState, structuredProductContent, getCart, saveCart, cartCount, addToCart };

try {
  const [catalogResponse, settingsResponse] = await Promise.all([fetch('/vitamin-express-preview/catalog/products.json'), fetch('/vitamin-express-preview/catalog/settings.json')]);
  if (!catalogResponse.ok || !settingsResponse.ok) throw new Error('Local fixture unavailable');
  catalog = await catalogResponse.json(); defaults = await settingsResponse.json();
  try {
    const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    settings = savedSettings.schema_version === defaults.schema_version
      ? { ...defaults, ...savedSettings, hero: { ...defaults.hero, ...savedSettings.hero }, thematic_shelf: { ...defaults.thematic_shelf }, cart_shipping_preview: { ...defaults.cart_shipping_preview }, currency_preview: { ...defaults.currency_preview }, delivery_preview: { ...defaults.delivery_preview }, flash_sale: { ...defaults.flash_sale } }
      : structuredClone(defaults);
  } catch { settings = structuredClone(defaults); }
  render();
} catch (error) {
  app.innerHTML = `<main class="page-shell"><div class="empty-state"><h1>Preview unavailable</h1><p>${escapeHtml(error.message)}. Start the demo from the project root and try again.</p></div></main>`;
}
