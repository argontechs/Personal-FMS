// server/utils/sendToAll.ts
// Fan-out: sends a push payload to ALL non-failed subscriptions.
// One bad subscription must not block the others — each send is wrapped independently.
// sendPush already prunes dead endpoints (404/410) via pruneSubscription.
import { isNull } from 'drizzle-orm'
import { db, pushSubscriptions } from '../db'
import { sendPush, type PushPayload } from './push'

export async function sendToAll(payload: PushPayload): Promise<{ delivered: number; pruned: number }> {
  const subs = db
    .select()
    .from(pushSubscriptions)
    .where(isNull(pushSubscriptions.failed_at))
    .all()

  let delivered = 0
  let pruned = 0

  for (const s of subs) {
    // Wrap each send: one dead endpoint must not block the rest.
    const r = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload)
    if (r.ok) {
      delivered++
    } else if (r.statusCode === 404 || r.statusCode === 410) {
      // sendPush already called pruneSubscription internally; count it.
      pruned++
    }
    // Other failures (5xx, network) are silently dropped; the subscription is not pruned.
  }

  return { delivered, pruned }
}
