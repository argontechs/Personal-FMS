import { describe, it, expect } from 'vitest'
import { ringgitToSen, senToRinggit, formatRM } from './money'

describe('money', () => {
  it('ringgitToSen converts RM to integer sen', () => {
    expect(ringgitToSen(7400.76)).toBe(740076)
    expect(ringgitToSen(5819.50)).toBe(581950)
    expect(ringgitToSen(0)).toBe(0)
  })
  it('ringgitToSen rounds float artefacts to nearest sen', () => {
    expect(ringgitToSen(0.1 + 0.2)).toBe(30) // 0.30000000000000004 → 30
    expect(ringgitToSen(199.995)).toBe(20000)
  })
  it('senToRinggit converts sen to RM', () => {
    expect(senToRinggit(740076)).toBe(7400.76)
    expect(senToRinggit(0)).toBe(0)
  })
  it('formatRM groups thousands with 2 dp', () => {
    expect(formatRM(740076)).toBe('RM7,400.76')
    expect(formatRM(581950)).toBe('RM5,819.50')
    expect(formatRM(0)).toBe('RM0.00')
    expect(formatRM(5)).toBe('RM0.05')
  })
  it('formatRM renders negatives with a leading minus', () => {
    expect(formatRM(-740076)).toBe('-RM7,400.76')
  })
})
