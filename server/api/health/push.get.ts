// server/api/health/push.get.ts
import { requireSession } from '../../utils/requireSession'
import { pushHealthSignal } from '../../utils/attention'

// Informational read (not state-changing) — session-gated per §14.22.
export default defineEventHandler((event) => {
  requireSession(event)
  return pushHealthSignal()
})
