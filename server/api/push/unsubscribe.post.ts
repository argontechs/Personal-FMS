import { eq } from 'drizzle-orm'
import { db, pushSubscriptions } from '../../db'
import { requireSession } from '../../utils/requireSession'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const body = await readBody(event)

  if (!body?.endpoint || typeof body.endpoint !== 'string' || !body.endpoint.startsWith('http')) {
    throw createError({ statusCode: 400, statusMessage: 'invalid endpoint' })
  }

  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint)).run()
  return { ok: true }
})
