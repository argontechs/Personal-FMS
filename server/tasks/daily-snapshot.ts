// server/tasks/daily-snapshot.ts
// Nitro scheduled task: write one metric snapshot per MYT day (the Trends history layer).
// Registered in nuxt.config.ts as '30 6 * * *' → daily, just after post-recurring (06:00)
// so the snapshot captures the day's auto-posted income/bills/interest.
// FLAT name 'daily-snapshot' ↔ flat file server/tasks/daily-snapshot.ts (colon = silent no-fire).
// The pure logic lives in server/utils/dailySnapshot.ts for direct testability.
import { runDailySnapshot } from '../utils/dailySnapshot';
import { sendAlert } from '../utils/alert';

export default defineTask({
  meta: {
    name: 'daily-snapshot',
    description: 'Write one daily net-worth / debt / card / EF / liquid snapshot (Trends history)',
  },
  async run() {
    try {
      const result = runDailySnapshot();
      console.log(`[daily-snapshot] date=${result.date} netWorth=${result.netWorthCents} card=${result.cardBalanceCents}`);
      return { result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sendAlert('daily-snapshot task failed', msg);
      throw err;
    }
  },
});
