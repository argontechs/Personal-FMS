// server/utils/requireSession.ts
import type { H3Event } from 'h3'
import { getCookie, createError } from 'h3'
import { db } from '../db/index'
import { resolveSession, SESSION_COOKIE, type Session } from './session'

export function requireSession(event: H3Event): Session {
  const id = getCookie(event, SESSION_COOKIE) ?? ''
  const session = resolveSession(db, id)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return session
}
