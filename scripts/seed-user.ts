import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { createDb } from '../server/db/index'
import { runMigrations } from '../server/db/migrate'
import { users } from '../server/db/schema'
import { hashPassword } from '../server/utils/password'
import { nowEpoch } from '../server/utils/mytDate'

type Db = BetterSQLite3Database<Record<string, unknown>>

export async function bootstrapUser(
  db: Db, username: string, plainPassword: string,
): Promise<{ id: number; created: boolean }> {
  const existing = db.select().from(users).all()
  if (existing.length > 0) return { id: existing[0].id, created: false }
  const ts = nowEpoch()
  const password_hash = await hashPassword(plainPassword)
  const id = db.insert(users).values({
    username, password_hash, session_epoch: 0, created_at: ts, updated_at: ts,
  }).returning({ id: users.id }).get().id
  return { id, created: true }
}

// CLI entry: `npm run seed:user` — reads creds from env, NEVER logs the secret.
if (process.argv[1] && process.argv[1].endsWith('seed-user.ts')) {
  const username = process.env.SEED_USERNAME
  const password = process.env.SEED_PASSWORD
  if (!username || !password) {
    console.error('Set SEED_USERNAME and SEED_PASSWORD env vars.')
    process.exit(1)
  }
  const path = (process.env.DATABASE_URL ?? 'file:./data/money.sqlite').replace(/^file:/, '')
  const handle = createDb(path)
  runMigrations(handle.sqlite)
  bootstrapUser(handle.db, username, password).then(({ id, created }) => {
    handle.sqlite.close()
    console.log(created ? `User created: ${username} (id ${id})` : 'A user already exists; refusing to create another.')
  })
}
