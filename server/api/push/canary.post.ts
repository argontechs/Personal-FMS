// server/api/push/canary.post.ts
// POST /api/push/canary — session-gated.
// Sends a "reminders are working" confirmation push to all of the user's non-failed subscriptions.
// Called by usePush after enabling notifications to confirm the pipeline is live.
import { defineEventHandler } from 'h3'
import { requireSession } from '../../utils/requireSession'
import { sendToAll } from '../../utils/sendToAll'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const r = await sendToAll({
    title: 'Reminders are working',
    body: 'You will get bill-due and payday prompts here.',
    url: '/?focus=reminders',
    tag: 'canary',
  })
  return r
})
