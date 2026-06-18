// server/utils/attention.ts
import { isNull, eq } from 'drizzle-orm'
import { db, recurringItems, pushSubscriptions } from '../db'
import { daysUntil, spayLaterNextAmount } from './dispatchBuilders'
import { formatRM } from './money'

export function pushHealthSignal(): { healthySubscriptions: number; channelOk: boolean } {
  const healthy = db.select().from(pushSubscriptions).where(isNull(pushSubscriptions.failed_at)).all()
  return { healthySubscriptions: healthy.length, channelOk: healthy.length > 0 }
}

export function collectAttention(todayISO: string): { line: string }[] {
  const items = db.select().from(recurringItems).where(eq(recurringItems.is_active, true)).all()
  const out: { line: string }[] = []
  for (const it of items) {
    if (!it.next_due_date) continue
    const d = daysUntil(todayISO, it.next_due_date)
    if (d < 0 || d > 7) continue
    if (it.direction !== 'expense') continue
    const amount = spayLaterNextAmount(it.remaining_installments_json, 0) ?? it.amount_cents
    out.push({ line: `${it.name} ${formatRM(amount)} due ${it.next_due_date}` })
  }
  if (!pushHealthSignal().channelOk) {
    out.push({ line: 'Push reminders are OFF — no working device subscription. Re-enable in the app (iOS: add to Home Screen first).' })
  }
  return out
}

export function renderAttentionEmail(items: { line: string }[]): { subject: string; text: string } {
  const body = items.length ? items.map(i => `- ${i.line}`).join('\n') : '- Nothing urgent this week. Nice.'
  return {
    subject: 'Money — What needs your attention this week',
    text: `What needs your attention\n\n${body}\n\nOpen: https://fms.argontechs.dev/`,
  }
}

export async function sendAttentionEmail(items: { line: string }[]): Promise<void> {
  const { sendMail } = await import('./mailer')
  const { subject, text } = renderAttentionEmail(items)
  await sendMail({ to: 'yongwei1127@gmail.com', subject, text })
}
