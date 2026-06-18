// server/utils/requireSession.ts
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { db } from '../db/index'
import { readSessionId, resolveSession, type Session } from './session'

export function requireSession(event: H3Event): Session {
  const id = readSessionId(event)
  if (!id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  const session = resolveSession(db, id)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return session
}
