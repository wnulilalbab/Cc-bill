// Merchant names from statement lines: strips ref numbers, dates, cities and country codes, so the same shop on
// different days gives the same key ("GRAB* A-1JUL01AAAA JAKARTA PUSATID" → "GRAB").

// Matched on the canonical form (single spaces), so a plain space is enough.
const PREFIX = /^(REVERSAL CICILAN(?: BCA)?|CICILAN(?: BCA)? KE \d+ DARI \d+,?|REVERSAL|REFUND|PEMBATALAN) /
const DOMAIN = /\.(CO\.ID|COM|NET|ORG|ID)\b/g
export const MONTHS = new Set(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'MEI', 'JUN', 'JUL', 'AUG', 'AGU', 'AGS', 'SEP', 'OCT', 'OKT', 'NOV', 'DEC', 'DES'])
export const COUNTRIES = new Set(['ID', 'IDN', 'USA', 'US', 'SGP', 'SG', 'IRL', 'NLD', 'GBR', 'AUS', 'MYS'])
/** Cities and districts printed after the merchant. Longest first so "JAKARTA PUSAT" goes before "JAKARTA". */
export const CITIES = [
  'JAKARTA PUSAT', 'JAKARTA SELATAN', 'JAKARTA SELAT', 'JAKARTA BARAT', 'JAKARTA TIMUR', 'JAKARTA UTARA', 'TANGERANG SELATAN',
  'SAN FRANCISCO', 'LOS GATOS', 'JAKARTA', 'BANDUNG', 'SURABAYA', 'TANGERANG', 'BEKASI', 'DEPOK', 'BOGOR', 'CIPUTAT', 'DENPASAR',
  'MEDAN', 'YOGYAKARTA', 'SEMARANG', 'SINGAPORE', 'DUBLIN', 'AMSTERDAM',
].map((c) => c.split(' '))
/** Last words a country code can be glued to ("PUSATID"). */
export const GLUE_BASES = new Set(['PUSAT', 'SELATAN', 'SELAT', 'BARAT', 'TIMUR', 'UTARA', ...CITIES.filter((c) => c.length === 1).map((c) => c[0])])

/** Upper case, single spaces. */
export const canonical = (description: string) => description.toUpperCase().replace(/\s+/g, ' ').trim()

function unglue(word: string): string {
  const m = /^([A-Z]+?)(IDN|ID)$/.exec(word)
  return m && GLUE_BASES.has(m[1]) ? m[1] : word
}

/** Strips country codes and cities from the end (in place). A single word is never shortened. */
function dropTail(out: string[]): string[] {
  for (let changed = true; changed && out.length > 1; ) {
    changed = false
    out[out.length - 1] = unglue(out[out.length - 1])
    if (COUNTRIES.has(out[out.length - 1])) {
      out.pop()
      changed = true
      continue
    }
    const city = CITIES.find((c) => c.length < out.length && c.every((w, i) => out[out.length - c.length + i] === w))
    if (city) {
      out.splice(out.length - city.length)
      changed = true
    }
  }
  return out
}

/** The merchant part of a statement line, upper case. Falls back to the whole line when nothing is left. */
export function normalizeMerchant(description: string): string {
  let s = canonical(description)
  while (PREFIX.test(s)) s = s.replace(PREFIX, '')
  const words = s
    .replace(DOMAIN, '')
    .replace(/[/*,]/g, ' ')
    .split(' ')
    .filter((w) => w && !/\d/.test(w) && !MONTHS.has(w) && /[A-Z]/.test(w))
  const kept = dropTail(words)
  return kept.join(' ') || canonical(description)
}

const MARKETPLACE = /\b(SHOPEE\w*|TOKOPEDIA|LAZADA|TIKTOK ?SHOP|BUKALAPAK)\b/

/**
 * Marketplaces: the statement line doesn't say who ordered. Phase-1 §5's four (Shopee incl. ShopeePay/ShopeeFood,
 * Tokopedia, Lazada, TikTok Shop) plus Bukalapak. Blibli is not one (Lead decision; the fixtures tag it without Check).
 */
export function isMarketplace(description: string): boolean {
  return MARKETPLACE.test(canonical(description))
}

/** The pattern an "Always tag X as Y" rule uses: the first two words of the merchant name. */
export function ruleKeyOf(description: string): string {
  return normalizeMerchant(description).split(' ').slice(0, 2).join(' ')
}
