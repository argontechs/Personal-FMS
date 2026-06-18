import { db, pushSubscriptions } from '../../db'
import { requireSession } from '../../utils/requireSession'
import { nowEpoch } from '../../utils/mytDate'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const body = await readBody(event)

  if (!body?.endpoint || typeof body.endpoint !== 'string' || !body.endpoint.startsWith('http')) {
    throw createError({ statusCode: 400, statusMessage: 'invalid subscription' })
  }
  if (!body?.keys?.p256dh || typeof body.keys.p256dh !== 'string' || !body.keys.p256dh) {
    throw createError({ statusCode: 400, statusMessage: 'invalid subscription' })
  }
  if (!body?.keys?.auth || typeof body.keys.auth !== 'string' || !body.keys.auth) {
    throw createError({ statusCode: 400, statusMessage: 'invalid subscription' })
  }

  const { endpoint, keys } = body as { endpoint: string; keys: { p256dh: string; auth: string } }
  const ua = getHeader(event, 'user-agent') ?? null

  const row = db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: ua, created_at: nowEpoch() })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: keys.p256dh, auth: keys.auth, user_agent: ua, failed_at: null },
    })
    .returning({ id: pushSubscriptions.id })
    .get()

  return { id: row.id }
})
