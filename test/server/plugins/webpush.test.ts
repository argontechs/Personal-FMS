import { describe, it, expect, vi, beforeEach } from 'vitest'

const setVapidDetails = vi.fn()
const sendNotification = vi.fn()
vi.mock('web-push', () => ({ default: { setVapidDetails, sendNotification } }))
vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    vapidPrivateKey: 'priv',
    vapidSubject: 'mailto:yongwei1127@gmail.com',
    public: { vapidPublicKey: 'pub' },
  }),
}))

describe('webpush util', () => {
  beforeEach(() => { setVapidDetails.mockClear(); sendNotification.mockClear() })

  it('configures VAPID details from runtime config', async () => {
    const { getWebPush } = await import('../../../server/utils/push')
    getWebPush()
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:yongwei1127@gmail.com', 'pub', 'priv')
  })

  it('sendPush returns ok:true on success', async () => {
    sendNotification.mockResolvedValueOnce({ statusCode: 201 })
    const { sendPush } = await import('../../../server/utils/push')
    const r = await sendPush(
      { endpoint: 'https://x', p256dh: 'a', auth: 'b' },
      { title: 'T', body: 'B', url: '/', tag: 'bill-due-1' },
    )
    expect(r).toEqual({ ok: true })
  })

  it('sendPush returns ok:false with statusCode on 410', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 410 })
    const { sendPush } = await import('../../../server/utils/push')
    const r = await sendPush({ endpoint: 'https://x', p256dh: 'a', auth: 'b' }, { title: 'T', body: 'B', url: '/', tag: 't' })
    expect(r).toEqual({ ok: false, statusCode: 410 })
  })
})
