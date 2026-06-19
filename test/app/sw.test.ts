import { describe, it, expect } from 'vitest'
import { handlePush, resolveClickUrl, isCacheableApiGet } from '../../app/sw'

describe('service worker push logic', () => {
  it('handlePush builds title + options with tag and deep-link url', () => {
    const { title, options } = handlePush({
      title: 'RM600 just landed',
      body: 'Move RM200 to your EF now?',
      url: '/?prompt=payday',
      tag: 'payday-save-2026-06-23',
      actions: [{ action: 'transfer', title: 'Transfer logged' }],
    })
    expect(title).toBe('RM600 just landed')
    expect(options.body).toBe('Move RM200 to your EF now?')
    expect(options.tag).toBe('payday-save-2026-06-23')
    expect((options.data as any).url).toBe('/?prompt=payday')
    expect(options.actions).toHaveLength(1)
  })

  it('handlePush falls back to a generic notification on malformed data', () => {
    const { title, options } = handlePush(null)
    expect(title).toBe('Money')
    expect(options.tag).toBe('generic')
  })

  it('resolveClickUrl returns data.url or root', () => {
    expect(resolveClickUrl({ url: '/forecast' })).toBe('/forecast')
    expect(resolveClickUrl({})).toBe('/')
  })
})

describe('isCacheableApiGet — runtime read-cache predicate', () => {
  it('caches GET requests to read API endpoints', () => {
    for (const p of [
      '/api/forecast',
      '/api/transactions',
      '/api/accounts',
      '/api/debt',
      '/api/debts',
      '/api/goals/progress',
      '/api/holdings',
      '/api/money-moves',
      '/api/recurring',
      '/api/trends',
      '/api/attention',
    ]) {
      expect(isCacheableApiGet(p, 'GET')).toBe(true)
    }
  })

  it('never caches non-GET methods (writes go through the offline queue)', () => {
    expect(isCacheableApiGet('/api/transactions', 'POST')).toBe(false)
    expect(isCacheableApiGet('/api/holdings', 'POST')).toBe(false)
    expect(isCacheableApiGet('/api/recurring/12', 'PATCH')).toBe(false)
    expect(isCacheableApiGet('/api/transactions/9', 'DELETE')).toBe(false)
  })

  it('never caches auth or internal endpoints, even on GET', () => {
    expect(isCacheableApiGet('/api/auth/login', 'GET')).toBe(false)
    expect(isCacheableApiGet('/api/auth/session', 'GET')).toBe(false)
    expect(isCacheableApiGet('/api/internal/run-due', 'GET')).toBe(false)
  })

  it('ignores non-api paths', () => {
    expect(isCacheableApiGet('/dashboard', 'GET')).toBe(false)
    expect(isCacheableApiGet('/login', 'GET')).toBe(false)
    expect(isCacheableApiGet('/', 'GET')).toBe(false)
  })
})
