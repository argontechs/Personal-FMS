// server/tasks/notify-dispatch.ts
// Registered as flat name 'notify-dispatch' (every-5-min cron in nuxt.config.ts).
// MYT ≥ 09:00 gate is enforced in runDispatch → selectDispatches.
import { runDispatch } from '../utils/dispatchRun'

export default defineTask({
  meta: {
    name: 'notify-dispatch',
    description: 'Bill reminders + payday-save prompts (09:00 MYT gate, idempotent claim, catch-up, fan-out)',
  },
  async run() {
    const result = await runDispatch()
    console.log(
      `[notify-dispatch] ${new Date().toISOString()} sent=${result.sent} skipped=${result.skipped}`,
    )
    return { result }
  },
})
