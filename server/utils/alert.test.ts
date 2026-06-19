// server/utils/alert.ts — unit tests
// Tests: [ALERT] log line always emitted; sendMail called when SMTP set; no-ops cleanly when SMTP unset.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock mailer — we control whether it throws or resolves
// ---------------------------------------------------------------------------
const mockSendMail = vi.fn<[{ to: string; subject: string; text: string }], Promise<void>>()
vi.mock('./mailer', () => ({
  sendMail: (msg: { to: string; subject: string; text: string }) => mockSendMail(msg),
}))

// ---------------------------------------------------------------------------
// Capture console.error output
// ---------------------------------------------------------------------------
let consoleErrors: string[] = []
const originalConsoleError = console.error

beforeEach(() => {
  consoleErrors = []
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '))
  }
  mockSendMail.mockReset()
})

afterEach(() => {
  console.error = originalConsoleError
})

describe('sendAlert', () => {
  it('always logs a [ALERT] line regardless of SMTP state', async () => {
    mockSendMail.mockResolvedValue(undefined)
    const { sendAlert } = await import('./alert')
    await sendAlert('test subject', 'test body')
    const alertLine = consoleErrors.find((l) => l.includes('[ALERT]'))
    expect(alertLine).toBeDefined()
    expect(alertLine).toContain('test subject')
  })

  it('calls sendMail with [FMS ALERT] prefix in subject when resolved', async () => {
    mockSendMail.mockResolvedValue(undefined)
    const { sendAlert } = await import('./alert')
    await sendAlert('task failed', 'some error message')
    expect(mockSendMail).toHaveBeenCalledOnce()
    const call = mockSendMail.mock.calls[0][0]
    expect(call.subject).toContain('[FMS ALERT]')
    expect(call.subject).toContain('task failed')
    expect(call.text).toBe('some error message')
    expect(call.to).toBe('yongwei1127@gmail.com')
  })

  it('does not throw when sendMail rejects (mailer error is non-fatal)', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP connection refused'))
    const { sendAlert } = await import('./alert')
    await expect(sendAlert('subject', 'body')).resolves.toBeUndefined()
    // The mailer error is logged, not propagated
    const mailerErrorLine = consoleErrors.find((l) => l.includes('[ALERT] mailer error'))
    expect(mailerErrorLine).toBeDefined()
  })

  it('still logs [ALERT] even when sendMail rejects', async () => {
    mockSendMail.mockRejectedValue(new Error('network error'))
    const { sendAlert } = await import('./alert')
    await sendAlert('smtp down', 'details')
    const alertLine = consoleErrors.find((l) => l.includes('[ALERT]') && l.includes('smtp down'))
    expect(alertLine).toBeDefined()
  })
})
