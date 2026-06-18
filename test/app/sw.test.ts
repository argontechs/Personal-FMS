import { describe, it, expect } from 'vitest'
import { handlePush, resolveClickUrl } from '../../app/sw'

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
