// test/app/goals.test.ts
// Goals page component tests — mounts in happy-dom, stubs /api/streaks.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, Suspense, ref } from 'vue'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockStreaks = {
  currentStreak: 3,
  longestStreak: 7,
  loggedToday: true,
  lastLoggedDate: '2026-06-19',
  milestones: [
    { key: 'first-log',  label: 'First spend logged',       achieved: true,  progress: 1,    detail: 'Log your first spend' },
    { key: 'streak-7',   label: '7-day streak',             achieved: true,  progress: 1,    detail: '7 days in a row' },
    { key: 'streak-30',  label: '30-day streak',            achieved: false, progress: 0.23, detail: '30 days in a row' },
    { key: 'ef-1000',    label: 'RM 1,000 emergency fund',  achieved: false, progress: 0.45, detail: 'RM 1,000 saved' },
    { key: 'card-paid',  label: 'Credit card cleared',      achieved: false, progress: 0,    detail: 'Zero card debt' },
    { key: 'ef-15000',   label: 'RM 15,000 emergency fund', achieved: false, progress: 0.03, detail: 'RM 15,000 saved' },
  ],
}

const mockStreaksZero = {
  currentStreak: 0,
  longestStreak: 0,
  loggedToday: false,
  lastLoggedDate: null,
  milestones: [
    { key: 'first-log',  label: 'First spend logged',       achieved: false, progress: 0, detail: 'Log your first spend' },
    { key: 'streak-7',   label: '7-day streak',             achieved: false, progress: 0, detail: '7 days in a row' },
    { key: 'streak-30',  label: '30-day streak',            achieved: false, progress: 0, detail: '30 days in a row' },
    { key: 'ef-1000',    label: 'RM 1,000 emergency fund',  achieved: false, progress: 0, detail: 'RM 1,000 saved' },
    { key: 'card-paid',  label: 'Credit card cleared',      achieved: false, progress: 0, detail: 'Zero card debt' },
    { key: 'ef-15000',   label: 'RM 15,000 emergency fund', achieved: false, progress: 0, detail: 'RM 15,000 saved' },
  ],
}

// Active data fixture — swap per test.
let activeStreaks: typeof mockStreaks | typeof mockStreaksZero | null = mockStreaks
let fetchShouldError = false

// ── #app mock ─────────────────────────────────────────────────────────────────
vi.mock('#app', () => ({
  useFetch: vi.fn(async (url: string) => {
    if (url === '/api/streaks') {
      if (fetchShouldError) return { data: ref(null), error: ref(new Error('Network error')) }
      return { data: ref(activeStreaks), error: ref(null) }
    }
    return { data: ref(null), error: ref(null) }
  }),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  navigateTo: vi.fn(),
  definePageMeta: vi.fn(),
  useRoute: vi.fn(() => ({ path: '/goals', name: 'goals', params: {}, query: {}, hash: '' })),
}))

// Import AFTER mocks
import GoalsPage from '../../app/pages/goals.vue'

// ── Helper ────────────────────────────────────────────────────────────────────
function mountGoals() {
  return mount(
    defineComponent({
      render() { return h(Suspense, null, { default: () => h(GoalsPage) }) },
    }),
  )
}

beforeEach(() => {
  activeStreaks = mockStreaks
  fetchShouldError = false
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('Goals page', () => {
  it('renders the current streak number (even if 0)', async () => {
    const w = mountGoals()
    await flushPromises()
    // currentStreak = 3
    expect(w.text()).toContain('3')
  })

  it('renders streak = 0 when no history', async () => {
    activeStreaks = mockStreaksZero
    const w = mountGoals()
    await flushPromises()
    expect(w.text()).toContain('0')
  })

  it('renders all 6 milestones', async () => {
    const w = mountGoals()
    await flushPromises()
    expect(w.text()).toContain('First spend logged')
    expect(w.text()).toContain('7-day streak')
    expect(w.text()).toContain('30-day streak')
    expect(w.text()).toContain('RM 1,000 emergency fund')
    expect(w.text()).toContain('Credit card cleared')
    expect(w.text()).toContain('RM 15,000 emergency fund')
  })

  it('achieved milestone shows check icon (check-icon class)', async () => {
    const w = mountGoals()
    await flushPromises()
    // first-log and streak-7 are achieved in mockStreaks
    const checkIcons = w.findAll('.milestone__check-icon')
    expect(checkIcons.length).toBeGreaterThanOrEqual(2)
  })

  it('locked milestone shows lock icon (lock-icon class)', async () => {
    const w = mountGoals()
    await flushPromises()
    // streak-30, ef-1000, card-paid, ef-15000 are locked in mockStreaks
    const lockIcons = w.findAll('.milestone__lock-icon')
    expect(lockIcons.length).toBeGreaterThanOrEqual(4)
  })

  it('achieved milestone has milestone--achieved class', async () => {
    const w = mountGoals()
    await flushPromises()
    const achieved = w.findAll('.milestone--achieved')
    expect(achieved.length).toBeGreaterThanOrEqual(2)
  })

  it('locked milestone has milestone--locked class', async () => {
    const w = mountGoals()
    await flushPromises()
    const locked = w.findAll('.milestone--locked')
    expect(locked.length).toBeGreaterThanOrEqual(4)
  })

  it('progress bar rendered for numeric milestone not yet achieved', async () => {
    const w = mountGoals()
    await flushPromises()
    // streak-30 is not achieved (progress=0.23) → should show progressbar
    const bars = w.findAll('[role="progressbar"]')
    expect(bars.length).toBeGreaterThanOrEqual(1)
  })

  it('start-streak nudge shown when streak=0 and not logged today', async () => {
    activeStreaks = mockStreaksZero
    const w = mountGoals()
    await flushPromises()
    expect(w.text()).toContain('Start your streak')
  })

  it('keep-streak nudge shown when streak>0 but not logged today', async () => {
    activeStreaks = { ...mockStreaks, loggedToday: false }
    const w = mountGoals()
    await flushPromises()
    expect(w.text()).toContain('keep your streak alive')
  })

  it('no nudge when already logged today', async () => {
    // mockStreaks has loggedToday=true
    const w = mountGoals()
    await flushPromises()
    expect(w.text()).not.toContain('keep your streak alive')
    expect(w.text()).not.toContain('Start your streak')
  })

  it('shows error message when API fails', async () => {
    fetchShouldError = true
    const w = mountGoals()
    await flushPromises()
    expect(w.text()).toContain('Failed to load goals')
  })
})
