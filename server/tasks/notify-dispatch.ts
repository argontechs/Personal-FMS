// server/tasks/notify-dispatch.ts
// Registered as flat name 'notify-dispatch' (every-5-min cron in nuxt.config.ts).
// MYT ≥ 09:00 gate is enforced in runDispatch → selectDispatches.
import { runDispatch } from '../utils/dispatchRun'
import { sendAlert } from '../utils/alert'

export default defineTask({
  meta: {
    name: 'notify-dispatch',
    description: 'Bill reminders + payday-save prompts (09:00 MYT gate, idempotent claim, catch-up, fan-out)',
  },
  async run() {
    try {
      const result = await runDispatch()
      console.log(
        `[notify-dispatch] ${new Date().toISOString()} sent=${result.sent} skipped=${result.skipped}`,
      )
      // Alert when dispatches were expected (non-zero skipped likely means a concurrent run is fine,
      // but zero sent AND zero skipped after the MYT gate could indicate a silent failure).
      if (result.sent === 0 && result.skipped === 0) {
        // This is normal outside of reminder windows — only noisy if it persists for many days.
        // We log but do not alert on every quiet run to avoid noise.
      }
      return { result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await sendAlert('notify-dispatch task failed', msg)
      throw err
    }
  },
})
