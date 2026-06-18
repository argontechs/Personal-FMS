// §4 single config block (integer sen). §14 #16: EF starts at RM1,000, migrates to RM15,000.
// BINDING B1: SAVINGS_TARGET_PER_CYCLE_SEN = RM500/mo split across 3 inflows = 16667 sen
export const BUFFER_FLOOR = 20000 // RM200 hard floor under cash
export const SAVINGS_TARGET_PER_CYCLE = 16667 // RM166.67 per cycle (RM500/mo ÷ 3 inflows, Buffer phase)
export const CARD_UTIL_WARN = 0.9 // amber
export const CARD_UTIL_DECLINE = 1.0 // hard decline — "card maxed, charges decline"
export const EF_STARTER_TARGET = 100000 // RM1,000 starter buffer
export const EF_FULL_TARGET = 1500000 // RM15,000 full (6-month) buffer
export const INFLOW_DAYS = [1, 3, 23] // 1st, salary day 3, 23rd (§4 next_inflow set)
