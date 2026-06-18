// server/api/auth/logout.post.ts
import { db } from '../../db/index'
import { readSessionId, revokeSession, clearSessionCookie } from '../../utils/session'

export default defineEventHandler((event) => {
  const id = readSessionId(event)
  if (id) revokeSession(db, id)
  clearSessionCookie(event)
  return { ok: true }
})
