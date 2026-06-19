// server/api/auth/session.get.ts
// Returns { authenticated: true, username } when a valid session cookie is present.
// requireSession throws a 401 automatically when not authenticated.
import { eq } from 'drizzle-orm'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { users } from '../../db/schema'

export default defineEventHandler((event) => {
  const session = requireSession(event)
  const user = db.select().from(users).where(eq(users.id, session.user_id)).get()
  const username = user?.username ?? ''
  return { authenticated: true, username }
})
