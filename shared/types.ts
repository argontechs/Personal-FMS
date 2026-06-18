// shared/types.ts — single source of truth for STS contract shared between client and server.
// Re-export so client composables import from here; the formula lives ONLY in server/utils/safeToSpend.ts.
export { computeSafeToSpend } from '../server/utils/safeToSpend'
export type { StsInput, StsResult } from '../server/utils/safeToSpend'
export { formatRM } from '../server/utils/money'
