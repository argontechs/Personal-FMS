// server/api/attention.get.ts
// Read-only endpoint: returns attention items + push health.
// Session-gated (same policy as /api/health/push).
import { defineEventHandler } from 'h3'
import { requireSession } from '../utils/requireSession'
import { collectAttention, pushHealthSignal } from '../utils/attention'

export default defineEventHandler((event) => {
  requireSession(event)
  const today = new Date().toISOString().slice(0, 10)
  return {
    items: collectAttention(today),
    push: pushHealthSignal(),
  }
})
