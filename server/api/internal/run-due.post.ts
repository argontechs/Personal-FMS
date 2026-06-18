// server/api/internal/run-due.post.ts
// PERMANENT watchdog endpoint (§8/§13/§14.10).
// NOT session-gated; protected by loopback-bound + constant-time secret.
// nginx MUST deny /api/internal/* from outside; OS-cron hits 127.0.0.1 directly.
// Secret env: NUXT_RUN_DUE_SECRET → runtimeConfig.runDueSecret
// Header:     x-run-due-secret
import { useRuntimeConfig, defineEventHandler, createError, getHeader } from '#imports'
import { isLoopback, secretMatches } from '../../utils/loopback'
import { runDispatch } from '../../utils/dispatchRun'
import { runPostRecurring } from '../../utils/postRecurring'

export default defineEventHandler(async (event) => {
  // 1. Loopback check — reject non-loopback before even touching the secret.
  const remote = event.node.req.socket.remoteAddress ?? undefined
  if (!isLoopback(remote)) {
    throw createError({ statusCode: 403, statusMessage: 'forbidden' })
  }

  // 2. Secret check — constant-time compare; also disabled-when-unset.
  const provided = getHeader(event, 'x-run-due-secret')
  const expected: string = (useRuntimeConfig() as any).runDueSecret ?? ''
  if (!secretMatches(provided, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
  }

  // 3. Run the due-work: post-recurring then notify-dispatch.
  // Both are idempotent; order matches the daily scheduled sequence.
  const postRecurring = runPostRecurring()
  const dispatch = await runDispatch()

  return { postRecurring, dispatch }
})
