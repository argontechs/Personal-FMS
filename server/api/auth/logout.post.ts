// server/api/auth/logout.post.ts
import { db } from '../../db/index'
import { revokeSession, SESSION_COOKIE, clearSessionCookie } from '../../utils/session'

export default defineEventHandler((event) => {
  const id = getCookie(event, SESSION_COOKIE)
  if (id) revokeSession(db, id)
  clearSessionCookie(event)
  return { ok: true }
})
