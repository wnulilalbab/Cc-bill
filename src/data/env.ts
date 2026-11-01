// Database names. Staging and production share an origin on GitHub Pages, so each environment gets its own
// database (the same way src/db.ts picks `CCBillDB-staging`). Names follow docs/intent/dev-loop.md.
export type AppEnv = 'staging' | 'production'

export function appEnv(): AppEnv {
  return typeof __APP_ENV__ !== 'undefined' && __APP_ENV__ === 'staging' ? 'staging' : 'production'
}

/** The Phase-1 database: `ccbill-v2` / `ccbill-v2-staging`. */
export function newDbName(env: AppEnv = appEnv()): string {
  return env === 'staging' ? 'ccbill-v2-staging' : 'ccbill-v2'
}

/** The pre-Phase-1 database (src/db.ts). Only ever read, or deleted by deleteOldData(). */
export function oldDbName(env: AppEnv = appEnv()): string {
  return env === 'staging' ? 'CCBillDB-staging' : 'CCBillDB'
}
