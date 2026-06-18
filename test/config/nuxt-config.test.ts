import { describe, it, expect } from 'vitest'
import config from '../../nuxt.config'

describe('nuxt.config', () => {
  const c = config as any
  it('pins the node-server preset', () => {
    expect(c.nitro.preset).toBe('node-server')
  })
  it('enables experimental tasks', () => {
    expect(c.nitro.experimental.tasks).toBe(true)
  })
  it('registers FLAT scheduled task names matching flat files', () => {
    const names = Object.values(c.nitro.scheduledTasks).flat()
    expect(names).toContain('post-recurring')
    expect(names).toContain('notify-dispatch')
    // No colon-namespaced names (colon → nested dir → silently never fires)
    expect(names.every((n: string) => !n.includes(':'))).toBe(true)
  })
  it('exposes an empty runtime VAPID public key (set at runtime via env)', () => {
    expect(c.runtimeConfig.public.vapidPublicKey).toBe('')
  })
})
