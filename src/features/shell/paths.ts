// The app's routes. The short paths are canonical; the Phase-1 build-out paths (/v2/...) redirect to them.
export const PATHS = {
  bill: '/bill',
  person: '/bill/person',
  transactions: '/transactions',
  payments: '/payments',
  import: '/import',
  settings: '/settings',
  rules: '/rules',
  share: '/share',
  insights: '/insights',
} as const

/** "/v2/bill/person/x?s=1" → "/bill/person/x?s=1". Any other path is returned unchanged. */
export function fromLegacy(pathname: string, search = ''): string {
  // Repeated slashes collapse: "/v2//evil.com" must never become a protocol-relative "//evil.com".
  const rest = pathname.replace(/^\/v2(?=\/|$)/, '').replace(/^\/{2,}/, '/')
  return `${rest || PATHS.bill}${search}`
}
