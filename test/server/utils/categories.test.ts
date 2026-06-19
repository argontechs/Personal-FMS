// test/server/utils/categories.test.ts
// Validates the shared category registry.
import { describe, it, expect } from 'vitest'
import { SPEND_CATEGORIES, categoryIcon } from '../../../shared/categories'

describe('SPEND_CATEGORIES registry', () => {
  it('has exactly 7 spend categories', () => {
    expect(SPEND_CATEGORIES.length).toBe(7)
  })

  it('contains all expected category keys in order', () => {
    const keys = SPEND_CATEGORIES.map(c => c.key)
    expect(keys).toEqual(['food', 'transport', 'fuel', 'groceries', 'shopping', 'bills', 'other'])
  })

  it('all categories have isLiving=true', () => {
    for (const cat of SPEND_CATEGORIES) {
      expect(cat.isLiving).toBe(true)
    }
  })

  it('all categories have non-empty label and icon', () => {
    for (const cat of SPEND_CATEGORIES) {
      expect(cat.label.length).toBeGreaterThan(0)
      expect(cat.icon.length).toBeGreaterThan(0)
    }
  })

  it('categoryIcon returns correct icon for known keys', () => {
    expect(categoryIcon('food')).toBe('utensils')
    expect(categoryIcon('transport')).toBe('bus')
    expect(categoryIcon('fuel')).toBe('fuel')
    expect(categoryIcon('groceries')).toBe('shopping-basket')
    expect(categoryIcon('shopping')).toBe('shopping-bag')
    expect(categoryIcon('bills')).toBe('receipt')
    expect(categoryIcon('other')).toBe('circle-dollar-sign')
  })

  it('categoryIcon falls back to circle-dollar-sign for unknown keys', () => {
    expect(categoryIcon('unknown-key')).toBe('circle-dollar-sign')
    expect(categoryIcon('')).toBe('circle-dollar-sign')
  })
})
