// server/api/__tests__/attention.get.test.ts
// Tests that GET /api/attention is session-gated and returns items + push health.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireSession = vi.fn(() => ({ id: 'sess-1', userId: 1 }))
vi.mock('../../utils/requireSession', () => ({
  requireSession: (...args: any[]) => mockRequireSession(...args),
}))

const mockCollectAttention = vi.fn(() => [{ line: 'Electricity RM120.00 due 2026-06-25' }])
const mockPushHealthSignal = vi.fn(() => ({ healthySubscriptions: 1, channelOk: true }))

vi.mock('../../utils/attention', () => ({
  collectAttention: (...args: any[]) => mockCollectAttention(...args),
  pushHealthSignal: () => mockPushHealthSignal(),
}))

import handler from '../attention.get'

function makeEvent() {
  return { node: { req: {}, res: {} }, context: {} } as any
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/attention', () => {
  beforeEach(() => {
    mockRequireSession.mockClear()
    mockCollectAttention.mockClear()
    mockPushHealthSignal.mockClear()
  })

  it('calls requireSession and rejects when not authenticated', () => {
    mockRequireSession.mockImplementationOnce(() => {
      throw { statusCode: 401, statusMessage: 'Unauthorized' }
    })
    expect(() => handler(makeEvent())).toThrow()
    expect(mockRequireSession).toHaveBeenCalledTimes(1)
  })

  it('returns items array and push health signal', () => {
    const result = handler(makeEvent()) as any
    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('push')
    expect(Array.isArray(result.items)).toBe(true)
    expect(result.items[0]).toHaveProperty('line')
    expect(result.push).toEqual({ healthySubscriptions: 1, channelOk: true })
  })

  it('passes today ISO to collectAttention', () => {
    handler(makeEvent())
    expect(mockCollectAttention).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    )
  })

  it('returns empty items array when nothing needs attention', () => {
    mockCollectAttention.mockReturnValueOnce([])
    const result = handler(makeEvent()) as any
    expect(result.items).toEqual([])
    expect(result.push.channelOk).toBe(true)
  })

  it('reflects channelOk: false when there are no healthy subscriptions', () => {
    mockPushHealthSignal.mockReturnValueOnce({ healthySubscriptions: 0, channelOk: false })
    const result = handler(makeEvent()) as any
    expect(result.push.channelOk).toBe(false)
    expect(result.push.healthySubscriptions).toBe(0)
  })
})
