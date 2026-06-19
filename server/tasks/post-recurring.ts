// server/tasks/post-recurring.ts
// Nitro scheduled task: auto-post due recurring templates + accrue card interest.
// Registered in nuxt.config.ts as '0 6 * * *' → daily, post-MYT-midnight.
// The pure logic lives in server/utils/postRecurring.ts for direct testability.
import { runPostRecurring } from '../utils/postRecurring';
import { sendAlert } from '../utils/alert';

export default defineTask({
  meta: {
    name: 'post-recurring',
    description: 'Auto-post due recurring templates and accrue card interest',
  },
  async run() {
    try {
      const result = runPostRecurring();
      console.log(`[post-recurring] posted=${result.posted} interest=${result.interest}`);
      return { result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sendAlert('post-recurring task failed', msg);
      throw err;
    }
  },
});
