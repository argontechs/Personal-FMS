// server/utils/loginBackoff.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { ensureBackoffTable, precheckLogin, recordFailure, recordSuccess } from './loginBackoff'

describe('loginBackoff', () => {
  let sqlite: Database.Database
  beforeEach(() => {
    sqlite = new Database(':memory:')
    ensureBackoffTable(sqlite)
  })
  afterEach(() => sqlite.close())

  it('allows a fresh account/IP', () => {
    expect(precheckLogin(sqlite, 'owner', '1.1.1.1').allowed).toBe(true)
  })

  it('locks the account after 3 failures', () => {
    recordFailure(sqlite, 'owner')
    recordFailure(sqlite, 'owner')
    expect(precheckLogin(sqlite, 'owner', '1.1.1.1').allowed).toBe(true)
    recordFailure(sqlite, 'owner')
    const r = precheckLogin(sqlite, 'owner', '1.1.1.1')
    expect(r.allowed).toBe(false)
    expect(r.retryAfterMs).toBeGreaterThan(0)
  })

  it('clears the lock on success', () => {
    recordFailure(sqlite, 'owner'); recordFailure(sqlite, 'owner'); recordFailure(sqlite, 'owner')
    recordSuccess(sqlite, 'owner')
    expect(precheckLogin(sqlite, 'owner', '1.1.1.1').allowed).toBe(true)
  })

  it('caps attempts per IP within the window', () => {
    for (let i = 0; i < 10; i++) precheckLogin(sqlite, `acct${i}`, '9.9.9.9')
    expect(precheckLogin(sqlite, 'acctX', '9.9.9.9').allowed).toBe(false)
  })
})
