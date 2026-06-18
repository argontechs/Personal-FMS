import { hash, verify, Algorithm } from '@node-rs/argon2'

// Params pinned in code (§9): argon2id, memory ≥ 19 MiB, time ≥ 2.
const OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS)
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, OPTS)
  } catch {
    return false
  }
}
