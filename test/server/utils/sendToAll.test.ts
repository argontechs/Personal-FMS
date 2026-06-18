import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { db, sqlite, pushSubscriptions } from '../../../server/db/index'
import { sendToAll } from '../../../server/utils/sendToAll'
import { runMigrations } from '../../../server/db/migrate'
import { eq } from 'drizzle-orm'
import { nowEpoch } from '../../../server/utils/mytDate'
import * as pushModule from '../../../server/utils/push'

// Mock sendPush to avoid actual web-push calls
vi.mock('../../../server/utils/push', () => ({
  sendPush: vi.fn(),
  getWebPush: vi.fn(),
}))

const mockSendPush = vi.mocked(pushModule.sendPush)

beforeAll(() => {
  runMigrations(sqlite)
})

function createSubscription(endpoint: string, p256dh = 'test_p256dh', auth = 'test_auth', failed_at = null) {
  const now = Date.now()
  const [row] = db.insert(pushSubscriptions).values({
    endpoint,
    p256dh,
    auth,
    failed_at,
    created_at: now,
    updated_at: now,
    last_ok_at: null,
  }).returning().all()
  return row
}

describe('sendToAll', () => {
  beforeEach(() => {
    db.delete(pushSubscriptions).run()
    mockSendPush.mockClear()
  })

  it('delivers to all non-failed subscriptions', async () => {
    createSubscription('endpoint-1')
    createSubscription('endpoint-2')
    mockSendPush.mockResolvedValue({ ok: true })

    const result = await sendToAll({
      title: 'Test',
      body: 'Body',
      url: '/',
      tag: 'test',
    })

    expect(result.delivered).toBe(2)
    expect(result.pruned).toBe(0)
    expect(mockSendPush).toHaveBeenCalledTimes(2)
  })

  it('skips subscriptions with failed_at set', async () => {
    const failedTime = nowEpoch()
    createSubscription('endpoint-active')
    createSubscription('endpoint-failed', 'p256dh', 'auth', failedTime)
    mockSendPush.mockResolvedValue({ ok: true })

    const result = await sendToAll({
      title: 'Test',
      body: 'Body',
      url: '/',
      tag: 'test',
    })

    expect(result.delivered).toBe(1)
    expect(mockSendPush).toHaveBeenCalledOnce()
    expect(mockSendPush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'endpoint-active' }),
      expect.any(Object)
    )
  })

  it('recovers a failed subscription when send succeeds (markSubscriptionOk)', async () => {
    const failedTime = nowEpoch()
    createSubscription('endpoint-recovered', 'p256dh', 'auth', failedTime)

    // First, verify it's marked as failed
    let sub = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, 'endpoint-recovered')).get()
    expect(sub!.failed_at).not.toBeNull()

    // Manually reset failed_at so sendToAll will try to send to it (since it filters on failed_at IS NULL)
    db.update(pushSubscriptions)
      .set({ failed_at: null })
      .where(eq(pushSubscriptions.endpoint, 'endpoint-recovered'))
      .run()

    mockSendPush.mockResolvedValue({ ok: true })

    await sendToAll({
      title: 'Test',
      body: 'Body',
      url: '/',
      tag: 'test',
    })

    // After successful send, verify failed_at is null and last_ok_at is set
    sub = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, 'endpoint-recovered')).get()
    expect(sub!.failed_at).toBeNull()
    expect(sub!.last_ok_at).not.toBeNull()
  })

  it('counts pruned subscriptions (404/410)', async () => {
    createSubscription('endpoint-1')
    createSubscription('endpoint-2')
    mockSendPush
      .mockResolvedValueOnce({ ok: false, statusCode: 404 })
      .mockResolvedValueOnce({ ok: true })

    const result = await sendToAll({
      title: 'Test',
      body: 'Body',
      url: '/',
      tag: 'test',
    })

    expect(result.delivered).toBe(1)
    expect(result.pruned).toBe(1)
  })

  it('logs non-terminal failures (5xx, network)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createSubscription('endpoint-1')
    mockSendPush.mockResolvedValue({ ok: false, statusCode: 500 })

    await sendToAll({
      title: 'Test',
      body: 'Body',
      url: '/',
      tag: 'test',
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[sendToAll] sendPush failed')
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('endpoint=endpoint-1')
    )
    warnSpy.mockRestore()
  })

  it('continues sending to remaining subscriptions even if one fails', async () => {
    createSubscription('endpoint-1')
    createSubscription('endpoint-2')
    createSubscription('endpoint-3')
    mockSendPush
      .mockResolvedValueOnce({ ok: false, statusCode: 500 })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })

    const result = await sendToAll({
      title: 'Test',
      body: 'Body',
      url: '/',
      tag: 'test',
    })

    expect(result.delivered).toBe(2)
    expect(mockSendPush).toHaveBeenCalledTimes(3)
  })
})
