import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

function resolvePath(): string {
  const url = process.env.DATABASE_URL
  if (url) return url.startsWith('file:') ? url.slice('file:'.length) : url
  return './data/money.sqlite'
}

export function createDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  if (path !== ':memory:') sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

const handle = createDb(resolvePath())
export const sqlite = handle.sqlite
export const db = handle.db
export default db

export * from './schema'
