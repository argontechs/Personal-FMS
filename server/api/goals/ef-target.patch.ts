// server/api/goals/ef-target.patch.ts
// Updates the EF (savings) goal's target_amount_cents.
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { goals } from '../../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const b = await readBody(event)

  if (typeof b?.targetAmountCents !== 'number' || !Number.isInteger(b.targetAmountCents) || b.targetAmountCents <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'targetAmountCents must be a positive integer' })
  }

  const efGoal = db.select().from(goals).where(eq(goals.type, 'savings')).get()
  if (!efGoal) {
    throw createError({ statusCode: 404, statusMessage: 'EF goal not found' })
  }

  const [updated] = db
    .update(goals)
    .set({ target_amount_cents: b.targetAmountCents, updated_at: Date.now() })
    .where(eq(goals.id, efGoal.id))
    .returning()
    .all()

  return updated
})
