// server/tasks/weekly-attention.ts
// Weekly email digest: "What needs your attention this week."
// Safety net for when iOS push silently stops delivering (dead subscription, revoked permission, etc.).
// Registered in nuxt.config.ts as '0 9 * * 1' (Monday 09:00 MYT, TZ Asia/Kuala_Lumpur).
import { collectAttention, sendAttentionEmail } from '../utils/attention'
import { todayMYT } from '../utils/mytDate'
import { sendAlert } from '../utils/alert'

export default defineTask({
  meta: {
    name: 'weekly-attention',
    description: 'Weekly "What needs your attention" email fallback (push-channel safety net)',
  },
  async run() {
    try {
      const today = todayMYT()
      const items = collectAttention(today)
      await sendAttentionEmail(items)
      console.log(`[weekly-attention] ${new Date().toISOString()} sent items=${items.length}`)
      return { sent: true, items: items.length }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await sendAlert('weekly-attention task failed', msg)
      throw err
    }
  },
})
