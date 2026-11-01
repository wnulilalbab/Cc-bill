// Database names. Staging and production share an origin on GitHub Pages, so each environment gets its own
// database (the old app's database was `CCBillDB` / `CCBillDB-staging` the same way). Names follow docs/intent/dev-loop.md.
export type AppEnv = 'staging' | 'production'

/** The build environment. Staging when it is not defined: a mistake then never touches production data. */
export function appEnv(): AppEnv {
  return typeof __APP_ENV__ !== 'undefined' && __APP_ENV__ === 'production' ? 'production' : 'staging'
}

/** The Phase-1 database: `ccbill-v2` / `ccbill-v2-staging`. */
export function newDbName(env: AppEnv = appEnv()): string {
  return env === 'staging' ? 'ccbill-v2-staging' : 'ccbill-v2'
}

/** The pre-Phase-1 database (the old app's Dexie `CCBillDB`, schema in test/data/oldDb.ts). Only ever read, or deleted by deleteOldData(). */
export function oldDbName(env: AppEnv = appEnv()): string {
  return env === 'staging' ? 'CCBillDB-staging' : 'CCBillDB'
}
