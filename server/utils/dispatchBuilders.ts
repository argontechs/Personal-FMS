import { formatRM } from './money'
import type { PushPayload } from './push'

export function daysUntil(todayISO: string, dueISO: string): number {
  const a = Date.UTC(+todayISO.slice(0, 4), +todayISO.slice(5, 7) - 1, +todayISO.slice(8, 10))
  const b = Date.UTC(+dueISO.slice(0, 4), +dueISO.slice(5, 7) - 1, +dueISO.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

export function dueWindow(daysOut: number): 'today' | '1-day' | '3-day' | null {
  if (daysOut === 0) return 'today'
  if (daysOut === 1) return '1-day'
  if (daysOut === 3) return '3-day'
  return null
}

export function spayLaterNextAmount(remaining_installments_json: string | null): number | null {
  if (!remaining_installments_json) return null
  const arr = JSON.parse(remaining_installments_json) as number[]
  return arr.length ? arr[0] : null
}

export function buildBillDuePayload(
  item: { name: string; amount_cents: number; remaining_installments_json: string | null; next_due_date: string },
  window: 'today' | '1-day' | '3-day',
): PushPayload {
  const amount = spayLaterNextAmount(item.remaining_installments_json) ?? item.amount_cents
  const whenText = window === 'today' ? 'due today' : window === '1-day' ? 'due tomorrow' : 'due in 3 days'
  return {
    title: `${item.name} ${whenText}`,
    body: `${formatRM(amount)} ${whenText} (${item.next_due_date}).`,
    url: '/?focus=bills',
    tag: `bill-due-${item.name}-${item.next_due_date}`,
  }
}

export function suggestedSavingsSen(cycleTargetRemainingSen: number): number {
  return Math.max(0, cycleTargetRemainingSen)
}

export function buildPaydayPayload(
  inflowName: string,
  inflowAmountSen: number,
  suggestedSen: number,
  scheduledFor: string,
): PushPayload {
  return {
    title: `${formatRM(inflowAmountSen)} just landed`,
    body: `Move ${formatRM(suggestedSen)} to your emergency fund now? You're cash-flow positive — this is the surplus that usually disappears.`,
    url: '/?prompt=payday',
    tag: `payday-save-${scheduledFor}`,
    actions: [
      { action: 'transfer', title: 'Transfer logged' },
      { action: 'adjust', title: 'Adjust' },
      { action: 'skip', title: 'Skip' },
    ],
  }
}
