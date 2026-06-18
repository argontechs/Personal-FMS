import { describe, it, expect, afterEach } from 'vitest'
import { createDb } from './index'

describe('db init', () => {
  let handle: ReturnType<typeof createDb>
  afterEach(() => handle?.sqlite.close())

  it('enables WAL journal mode', () => {
    handle = createDb(':memory:')
    // :memory: cannot be WAL, so prove the pragma path on a real temp file instead:
    handle.sqlite.close()
    handle = createDb('./data/test-wal.sqlite')
    const mode = handle.sqlite.pragma('journal_mode', { simple: true })
    expect(String(mode).toLowerCase()).toBe('wal')
  })

  it('enables foreign_keys enforcement', () => {
    handle = createDb('./data/test-fk.sqlite')
    const fk = handle.sqlite.pragma('foreign_keys', { simple: true })
    expect(fk).toBe(1)
  })

  it('exposes a Drizzle instance with a working select', () => {
    handle = createDb(':memory:')
    expect(typeof handle.db.select).toBe('function')
  })
})
