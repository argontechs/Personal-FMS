import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createDb } from './index'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

export function runMigrations(sqlite: BetterSqlite3.Database): void {
  const d = drizzle(sqlite)
  migrate(d, { migrationsFolder })
}

// CLI entry: `npm run db:migrate` opens the real DATABASE_URL DB and migrates it.
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  const path = (process.env.DATABASE_URL ?? 'file:./data/money.sqlite').replace(/^file:/, '')
  const handle = createDb(path)
  runMigrations(handle.sqlite)
  handle.sqlite.close()
  console.log('Migrations applied to', path)
}
