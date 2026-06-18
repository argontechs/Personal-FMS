import { eq } from 'drizzle-orm'
import { db, pushSubscriptions } from '../db'
import { nowEpoch } from './mytDate'

export function pruneSubscription(endpoint: string): void {
  db.update(pushSubscriptions)
    .set({ failed_at: nowEpoch() })
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .run()
}

export function markSubscriptionOk(endpoint: string): void {
  db.update(pushSubscriptions)
    .set({ last_ok_at: nowEpoch(), failed_at: null })
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .run()
}
