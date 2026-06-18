// test/server/api/push/subscribe.test.ts
// Unit tests for pruneSubscription / markSubscriptionOk utils + prune-on-404/410 sendPush wiring.
// Uses the vitest node project's :memory: DATABASE_URL singleton.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sqlite, db } from '../../../../server/db/index'
import { runMigrations } from '../../../../server/db/migrate'
import { eq } from 'drizzle-orm'
import { pushSubscriptions } from '../../../../server/db/schema'

// Hoist web-push mock before any imports so the module sees the mock.
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}))

// Run migrations on the :memory: singleton so all tables exist.
beforeAll(() => {
  runMigrations(sqlite)
})

beforeEach(() => {
  db.delete(pushSubscriptions).run()
})

describe('push subscription utils', () => {
  it('pruneSubscription sets failed_at on the matching row', async () => {
    const { pruneSubscription } = await import('../../../../server/utils/pruneSubscription')
    db.insert(pushSubscriptions).values({
      endpoint: 'https://push/1', p256dh: 'a', auth: 'b', created_at: 1,
    }).run()
    pruneSubscription('https://push/1')
    const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, 'https://push/1')).get()
    expect(row!.failed_at).not.toBeNull()
  })

  it('markSubscriptionOk clears failed_at and sets last_ok_at', async () => {
    const { markSubscriptionOk } = await import('../../../../server/utils/pruneSubscription')
    db.insert(pushSubscriptions).values({
      endpoint: 'https://push/2', p256dh: 'a', auth: 'b', created_at: 1, failed_at: 999,
    }).run()
    markSubscriptionOk('https://push/2')
    const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, 'https://push/2')).get()
    expect(row!.failed_at).toBeNull()
    expect(row!.last_ok_at).not.toBeNull()
  })
})

describe('sendPush — prune on dead subscription', () => {
  it('sendPush with a 404 error calls pruneSubscription (sets failed_at)', async () => {
    db.insert(pushSubscriptions).values({
      endpoint: 'https://push/dead-404', p256dh: 'ppp', auth: 'aaa', created_at: 1,
    }).run()

    // Configure the mock to throw a 404.
    const webpush = (await import('web-push')).default
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(
      Object.assign(new Error('Gone'), { statusCode: 404 }),
    )

    const { sendPush } = await import('../../../../server/utils/push')
    const result = await sendPush(
      { endpoint: 'https://push/dead-404', p256dh: 'ppp', auth: 'aaa' },
      { title: 'T', body: 'B', url: '/', tag: 't' },
    )
    expect(result.ok).toBe(false)
    expect((result as any).statusCode).toBe(404)

    // pruneSubscription should have been called — failed_at is now set.
    const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, 'https://push/dead-404')).get()
    expect(row!.failed_at).not.toBeNull()
  })

  it('sendPush with a 410 error also calls pruneSubscription', async () => {
    db.insert(pushSubscriptions).values({
      endpoint: 'https://push/dead-410', p256dh: 'ppp', auth: 'aaa', created_at: 1,
    }).run()

    const webpush = (await import('web-push')).default
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(
      Object.assign(new Error('Subscription expired'), { statusCode: 410 }),
    )

    const { sendPush } = await import('../../../../server/utils/push')
    const result = await sendPush(
      { endpoint: 'https://push/dead-410', p256dh: 'ppp', auth: 'aaa' },
      { title: 'T', body: 'B', url: '/', tag: 't' },
    )
    expect(result.ok).toBe(false)
    expect((result as any).statusCode).toBe(410)

    const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, 'https://push/dead-410')).get()
    expect(row!.failed_at).not.toBeNull()
  })

  it('sendPush with a non-404/410 error does NOT set failed_at', async () => {
    db.insert(pushSubscriptions).values({
      endpoint: 'https://push/transient', p256dh: 'ppp', auth: 'aaa', created_at: 1,
    }).run()

    const webpush = (await import('web-push')).default
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(
      Object.assign(new Error('Server error'), { statusCode: 500 }),
    )

    const { sendPush } = await import('../../../../server/utils/push')
    const result = await sendPush(
      { endpoint: 'https://push/transient', p256dh: 'ppp', auth: 'aaa' },
      { title: 'T', body: 'B', url: '/', tag: 't' },
    )
    expect(result.ok).toBe(false)
    expect((result as any).statusCode).toBe(500)

    // failed_at should NOT be set for transient errors.
    const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, 'https://push/transient')).get()
    expect(row!.failed_at).toBeNull()
  })
})
