// test/server/tasks/weekly-attention.test.ts
// Verifies weekly-attention is registered in scheduledTasks and calls sendAttentionEmail.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import config from '../../../nuxt.config'

// ---------------------------------------------------------------------------
// Shim Nitro's defineTask global
// ---------------------------------------------------------------------------
;(globalThis as any).defineTask = <T>(def: T): T => def

// ---------------------------------------------------------------------------
// Shim #imports
// ---------------------------------------------------------------------------
vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(() => ({})),
  defineEventHandler: (fn: Function) => fn,
  createError: ({ statusCode, statusMessage }: { statusCode: number; statusMessage: string }) => {
    const e = new Error(statusMessage) as any
    e.statusCode = statusCode
    return e
  },
  getHeader: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock attention utils so the task can run without a DB
// ---------------------------------------------------------------------------
const mockCollectAttention = vi.fn(() => [{ line: 'Mock bill RM100 due 2026-06-23' }])
const mockSendAttentionEmail = vi.fn<[{ line: string }[]], Promise<void>>().mockResolvedValue(undefined)

vi.mock('../../../server/utils/attention', () => ({
  collectAttention: (today: string) => mockCollectAttention(today),
  sendAttentionEmail: (items: { line: string }[]) => mockSendAttentionEmail(items),
  renderAttentionEmail: vi.fn(),
  pushHealthSignal: vi.fn(() => ({ healthySubscriptions: 1, channelOk: true })),
}))

vi.mock('../../../server/utils/mytDate', () => ({
  todayMYT: vi.fn(() => '2026-06-23'),
}))

vi.mock('../../../server/utils/alert', () => ({
  sendAlert: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// 1. Config-level: weekly-attention is registered with a valid Monday cron
// ---------------------------------------------------------------------------
describe('nuxt.config — weekly-attention registration', () => {
  const c = config as any
  const allNames: string[] = Object.values(c.nitro.scheduledTasks).flat() as string[]

  it('registers weekly-attention in scheduledTasks', () => {
    expect(allNames).toContain('weekly-attention')
  })

  it('weekly-attention is scheduled on a valid 5-field cron expression', () => {
    const schedule = Object.entries(c.nitro.scheduledTasks).find(([, v]) =>
      (v as string[]).includes('weekly-attention'),
    )
    expect(schedule).toBeDefined()
    expect((schedule![0] as string).split(' ')).toHaveLength(5)
  })

  it('weekly-attention cron targets day-of-week 1 (Monday)', () => {
    const schedule = Object.entries(c.nitro.scheduledTasks).find(([, v]) =>
      (v as string[]).includes('weekly-attention'),
    )
    const cronFields = (schedule![0] as string).split(' ')
    // cron: minute hour dom month dow — dow=1 is Monday
    expect(cronFields[4]).toBe('1')
  })

  it('weekly-attention cron fires at 09:00 (hour field = 9)', () => {
    const schedule = Object.entries(c.nitro.scheduledTasks).find(([, v]) =>
      (v as string[]).includes('weekly-attention'),
    )
    const cronFields = (schedule![0] as string).split(' ')
    expect(cronFields[1]).toBe('9')
  })

  it('all registered names remain FLAT (no colons)', () => {
    expect(allNames.every((n) => !n.includes(':'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Task-file level: weekly-attention calls sendAttentionEmail
// ---------------------------------------------------------------------------
describe('server/tasks/weekly-attention.ts — defineTask contract', () => {
  let task: any

  beforeAll(async () => {
    const mod = await import('../../../server/tasks/weekly-attention.ts')
    task = mod.default
  })

  it('exports a task object', () => {
    expect(task).toBeDefined()
    expect(typeof task).toBe('object')
  })

  it('meta.name is "weekly-attention" (flat, matches file name)', () => {
    expect(task.meta?.name).toBe('weekly-attention')
  })

  it('run() is a callable async function', () => {
    expect(typeof task.run).toBe('function')
  })

  it('run() calls sendAttentionEmail with items from collectAttention', async () => {
    mockCollectAttention.mockReturnValueOnce([{ line: 'Celcom RM80 due 2026-06-23' }])
    mockSendAttentionEmail.mockResolvedValueOnce(undefined)

    const result = await task.run()

    expect(mockSendAttentionEmail).toHaveBeenCalledOnce()
    expect(mockSendAttentionEmail.mock.calls[0][0]).toEqual([{ line: 'Celcom RM80 due 2026-06-23' }])
    expect(result.sent).toBe(true)
    expect(result.items).toBe(1)
  })

  it('run() returns items count from collectAttention', async () => {
    mockCollectAttention.mockReturnValueOnce([
      { line: 'Bill A RM50 due 2026-06-23' },
      { line: 'Bill B RM80 due 2026-06-24' },
    ])
    mockSendAttentionEmail.mockResolvedValueOnce(undefined)

    const result = await task.run()
    expect(result.items).toBe(2)
  })
})
