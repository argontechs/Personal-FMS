import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password (argon2id)', () => {
  it('produces an argon2id hash', async () => {
    const h = await hashPassword('correct-horse-battery-staple')
    expect(h.startsWith('$argon2id$')).toBe(true)
  }, 15000)

  it('verifies a correct password', async () => {
    const h = await hashPassword('s3cr3t-pass')
    expect(await verifyPassword(h, 's3cr3t-pass')).toBe(true)
  }, 15000)

  it('rejects a wrong password without throwing', async () => {
    const h = await hashPassword('s3cr3t-pass')
    expect(await verifyPassword(h, 'wrong-pass')).toBe(false)
  }, 15000)

  it('produces distinct hashes for the same input (random salt)', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  }, 15000)
})
