// shared/categories.ts — single source of truth for spend category metadata.
// System categories (income, savings, debt, interest, adjustment, transfer) are NOT listed here.

export interface SpendCategory {
  key: string
  label: string
  icon: string   // Lucide icon name (kebab-case)
  isLiving: boolean
}

export const SPEND_CATEGORIES: SpendCategory[] = [
  { key: 'food',      label: 'Food',      icon: 'utensils',           isLiving: true },
  { key: 'transport', label: 'Transport', icon: 'bus',                isLiving: true },
  { key: 'fuel',      label: 'Fuel',      icon: 'fuel',               isLiving: true },
  { key: 'groceries', label: 'Groceries', icon: 'shopping-basket',    isLiving: true },
  { key: 'shopping',  label: 'Shopping',  icon: 'shopping-bag',       isLiving: true },
  { key: 'bills',     label: 'Bills',     icon: 'receipt',            isLiving: true },
  { key: 'other',     label: 'Other',     icon: 'circle-dollar-sign', isLiving: true },
]

/** Returns the Lucide icon name for a given category key, or 'circle-dollar-sign' for unknown. */
export function categoryIcon(key: string): string {
  return SPEND_CATEGORIES.find(c => c.key === key)?.icon ?? 'circle-dollar-sign'
}
