import french from './locales/fr-CA.js';

const searchTranslations = new Map(Object.entries(french).map(([key, value]) => [key.toLowerCase(), value]));

const LANGUAGE_KEY = 'vitamin-express-language-v1';
export const supportedLocales = ['en-CA', 'fr-CA'];
let locale = 'en-CA';
const requested = new URLSearchParams(location.search).get('lang');
try {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  if (supportedLocales.includes(saved)) locale = saved;
} catch { /* English remains usable without browser storage. */ }
if (requested === 'fr' || requested === 'en') {
  locale = requested === 'fr' ? 'fr-CA' : 'en-CA';
  try { localStorage.setItem(LANGUAGE_KEY, locale); } catch { /* URL selection still works. */ }
}
export const getLocale = () => locale;
export function setLocale(value) {
  if (!supportedLocales.includes(value)) return false;
  locale = value;
  try { localStorage.setItem(LANGUAGE_KEY, value); } catch { /* Keep the in-memory choice. */ }
  const url = new URL(location.href);
  url.searchParams.set('lang', value === 'fr-CA' ? 'fr' : 'en');
  history.replaceState(history.state, '', url);
  return true;
}

// Only complete interface strings and explicit dynamic UI patterns are translated.
// Never substitute arbitrary words inside product names, variants or manufacturer copy.
export function t(value) {
  if (locale !== 'fr-CA' || typeof value !== 'string') return value;
  const text = value.trim();
  let translated = Object.hasOwn(french, text) ? french[text] : undefined;
  if (!translated) {
    const patterns = [
      [/^(.*?)(\s*[→←×])$/, (_, label, arrow) => `${t(label)}${arrow}`],
      [/^(.+):$/, (_, label) => `${t(label)} :`],
      [/^← (.+)$/, (_, label) => `← ${t(label)}`],
      [/^(\d+) products?$/, (_, count) => `${count} produit${count === '1' ? '' : 's'}`],
      [/^(\d+) of (\d+) products$/, (_, count, total) => `${count} produits sur ${total}`],
      [/^(\d+) brands?$/, (_, count) => `${count} marque${count === '1' ? '' : 's'}`],
      [/^Showing (\d+) brands$/, (_, count) => `${count} marques affichées`],
      [/^Save (.+) for later$/, (_, name) => `Enregistrer ${name} pour plus tard`],
      [/^Save ([\d$].+)$/, (_, amount) => `Économisez ${amount.replace(' percent', ' pour cent').replace('%', ' %')}`],
      [/^(.+) · Save (\d+)%$/, (_, price, percent) => `${price} · Économisez ${percent} %`],
      [/^Product image shown\. Packaging may vary for (.+)\.$/, (_, variant) => `Image du produit. L’emballage peut varier pour l’option ${variant}.`],
      [/^Current price (.+)$/, (_, price) => `Prix actuel ${price}`],
      [/^Reference price (.+)$/, (_, price) => `Prix de référence ${price}`],
      [/^Available variant price range (.+)$/, (_, price) => `Fourchette de prix des variantes disponibles : ${price}`],
      [/^Add (.+) more for free shipping$/, (_, price) => `Encore ${price} pour la livraison gratuite`],
      [/^Open cart, (\d+) items?$/, (_, count) => `Ouvrir le panier, ${count} article${count === '1' ? '' : 's'}`],
      [/^(\d+) items? in cart$/, (_, count) => `${count} article${count === '1' ? '' : 's'} dans le panier`],
      [/^Quantity for (.+)$/, (_, name) => `Quantité pour ${name}`],
      [/^Open (.+) menu$/, (_, label) => `Ouvrir le menu ${t(label)}`],
      [/^View (\d+) products$/, (_, count) => `Voir ${count} produits`],
      [/^(Filter|Filter products) \((\d+)\)$/, (_, label, count) => `${t(label)} (${count})`],
      [/^Results for “(.*?)”(?: in (.+))?$/, (_, query, scope) => `Résultats pour « ${query} »${scope ? ` dans ${t(scope)}` : ''}`],
      [/^Search in (.+)$/, (_, scope) => `Rechercher dans ${t(scope)}`],
      [/^We couldn’t find “(.*?)”(?: in (.+))?\. Try a brand, ingredient or a shorter term\.$/, (_, query, scope) => `Aucun résultat pour « ${query} »${scope ? ` dans ${t(scope)}` : ''}. Essayez une marque, un ingrédient ou un terme plus court.`],
      [/^(.+) added to the local cart\.$/, (_, name) => `${name} ajouté au panier local.`],
      [/^Show image (\d+) of (\d+)$/, (_, index, total) => `Afficher l’image ${index} sur ${total}`],
      [/^Show campaign (\d+): (.+)$/, (_, index, title) => `Afficher la bannière ${index} : ${t(title)}`],
      [/^Campaign (\d+) of (\d+): (.+)$/, (_, index, total, title) => `Bannière ${index} sur ${total} : ${t(title)}`],
      [/^(\d+) brands? match “(.+)”$/, (_, count, query) => `${count} marque${count === '1' ? '' : 's'} pour « ${query} »`],
      [/^(\d+) authentic catalog brands, organized for fast scanning instead of oversized cards\.$/, (_, count) => `${count} marques du catalogue, réunies dans un répertoire facile à parcourir.`],
      [/^(\d+)(?: of (\d+))? products · (\d+) sourced brands$/, (_, count, total, brands) => `${count}${total ? ` sur ${total}` : ''} produits · ${brands} marques documentées`],
      [/^(?:Preview countdown: )?(\d+) days, (\d+) hours, (\d+) minutes and (\d+) seconds remaining$/, (_, days, hours, minutes, seconds) => `${text.startsWith('Preview') ? 'Compte à rebours de démonstration : ' : ''}${days} jours, ${hours} heures, ${minutes} minutes et ${seconds} secondes restantes`],
      [/^(.+) sign-in preview$/, (_, provider) => `Aperçu de la connexion : ${t(provider)}`],
      [/^(.+) is shown as an interface preview only\. Shopify Customer Accounts and eligible identity providers require merchant configuration\. No credential, code or account data is collected here\.$/, (_, provider) => `${t(provider)} est présenté en démonstration seulement. Les comptes Shopify et fournisseurs admissibles doivent être configurés. Aucun identifiant, code ou renseignement de compte n’est recueilli ici.`],
      [/^View (.+)$/, (_, name) => `Voir ${name}`],
      [/^(Previous|Next) (.+)$/, (_, direction, label) => `${t(label)} — ${direction === 'Previous' ? 'précédents' : 'suivants'}`],
      [/^(.+) products$/, (_, title) => `Produits : ${t(title)}`],
      [/^(.+) product types$/, (_, title) => `Types de produits : ${t(title)}`],
      [/^Explore (.+)$/, (_, title) => `Explorer : ${t(title)}`],
      [/^Enlarge (.+) image$/, (_, name) => `Agrandir l’image de ${name}`],
      [/^Shop (.+)$/, (_, title) => `Magasiner : ${t(title)}`],
      [/^Read (.+)$/, (_, title) => french[title] ? `Lire : ${t(title)}` : text],
      [/^© (\d+) Vitamin Express\. All rights reserved\.$/, (_, year) => `© ${year} Vitamin Express. Tous droits réservés.`],
    ];
    for (const [pattern, replace] of patterns) {
      if (pattern.test(text)) { translated = text.replace(pattern, replace); break; }
    }
  }
  return translated ? value.replace(text, translated) : value;
}

// Run once after each explicit render, before paint; no observer or HTML string rewriting.
export function localize(root) {
  if (locale !== 'fr-CA') return;
  for (const element of root.querySelectorAll('.product-title,.product-brand,.cart-line-title,.cart-line h2,.pdp-identity h1,.variant-option > span,.variant-group strong')) {
    element.setAttribute('translate', 'no');
    element.setAttribute('lang', 'en');
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('[translate="no"],script,style,textarea')) continue;
    node.nodeValue = t(node.nodeValue);
  }
  for (const element of root.querySelectorAll('[aria-label],[placeholder],[title],[alt]')) {
    if (element.closest('[translate="no"]')) continue;
    for (const attribute of ['aria-label', 'placeholder', 'title', 'alt']) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, t(element.getAttribute(attribute)));
    }
  }
}

export function searchText(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
// Search both names and translated taxonomy without changing canonical filter values or URLs.
export function localizedSearchText(value) {
  return searchText(`${value} ${searchTranslations.get(String(value).toLowerCase()) || ''}`);
}
