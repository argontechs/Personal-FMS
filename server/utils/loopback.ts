// server/utils/loopback.ts
// Loopback guard + constant-time secret compare for the run-due watchdog.
import { timingSafeEqual } from 'node:crypto'

/**
 * Returns true when remoteAddress is a loopback address.
 * Accepts IPv4 (127.0.0.1), IPv6 (::1), and IPv4-mapped IPv6 (::ffff:127.0.0.1).
 */
export function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  )
}

/**
 * Constant-time secret comparison.
 * Returns false if either value is missing or empty — an unset expected
 * secret means the endpoint is disabled.
 */
export function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
