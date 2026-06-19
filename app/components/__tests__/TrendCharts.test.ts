// app/components/__tests__/TrendCharts.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TrendCharts from '../trends/TrendCharts.vue'

const series = [
  { date: '2026-06-17', netWorthCents: 5800000, totalDebtCents: 880000, cardBalanceCents: 740076, efBalanceCents: 40000, liquidCents: 300000 },
  { date: '2026-06-18', netWorthCents: 5850000, totalDebtCents: 870000, cardBalanceCents: 730000, efBalanceCents: 42000, liquidCents: 302000 },
  { date: '2026-06-19', netWorthCents: 5893020, totalDebtCents: 864277, cardBalanceCents: 720000, efBalanceCents: 45000, liquidCents: 305000 },
]
const spendByCategory = [
  { category: 'food', amountCents: 45000 },
  { category: 'transport', amountCents: 18000 },
]

describe('TrendCharts', () => {
  it('renders the SVG line + sparkline + category bars with ≥2 data points', () => {
    const w = mount(TrendCharts, { props: { series, spendByCategory } })
    expect(w.find('[data-testid="trends-charts"]').exists()).toBe(true)
    expect(w.find('[data-testid="trends-line"]').exists()).toBe(true)
    expect(w.find('[data-testid="trends-spark"]').exists()).toBe(true)
    expect(w.find('[data-testid="trends-bars"]').exists()).toBe(true)
    // Each line path has a non-empty `d` attribute (path actually drawn).
    const paths = w.findAll('path.trend-line__nw, path.trend-line__card')
    expect(paths.length).toBe(2)
    paths.forEach((p) => expect(p.attributes('d')?.startsWith('M')).toBe(true))
    expect(w.find('[data-testid="trends-empty"]').exists()).toBe(false)
  })

  it('renders one bar row per spend category with progressbar a11y', () => {
    const w = mount(TrendCharts, { props: { series, spendByCategory } })
    const rows = w.findAll('.trend-bar-row')
    expect(rows.length).toBe(2)
    expect(w.text()).toContain('Food')
    expect(w.text()).toContain('Transport')
    const bars = w.findAll('[role="progressbar"]')
    expect(bars.length).toBe(2)
    // Largest category (food) fills 100%.
    expect(bars[0].attributes('aria-valuenow')).toBe('100')
  })

  it('charts have aria-labels (img role) for screen readers', () => {
    const w = mount(TrendCharts, { props: { series, spendByCategory } })
    const line = w.find('[data-testid="trends-line"]')
    expect(line.attributes('role')).toBe('img')
    expect(line.attributes('aria-label')).toContain('Net worth')
  })

  it('the data-table toggle reveals an accessible table fallback', async () => {
    const w = mount(TrendCharts, { props: { series, spendByCategory } })
    // Hidden by default.
    expect(w.find('[data-testid="trends-table"]').exists()).toBe(false)
    await w.find('[data-testid="trends-table-toggle"]').trigger('click')
    expect(w.find('[data-testid="trends-table"]').exists()).toBe(true)
    const table = w.find('table.trend-data-table')
    expect(table.exists()).toBe(true)
    // One header row + 3 data rows.
    expect(w.findAll('tbody tr').length).toBe(3)
  })

  it('shows the empty state with <2 data points (single point)', () => {
    const w = mount(TrendCharts, { props: { series: [series[0]], spendByCategory } })
    expect(w.find('[data-testid="trends-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="trends-charts"]').exists()).toBe(false)
    expect(w.text()).toContain('Trends build up as you use the app')
  })

  it('shows the empty state with zero data points', () => {
    const w = mount(TrendCharts, { props: { series: [], spendByCategory: [] } })
    expect(w.find('[data-testid="trends-empty"]').exists()).toBe(true)
    expect(w.text()).toContain('Check back in a few days')
  })

  it('renders a friendly note when there is data but no spend in the window', () => {
    const w = mount(TrendCharts, { props: { series, spendByCategory: [] } })
    expect(w.find('[data-testid="trends-charts"]').exists()).toBe(true)
    expect(w.find('[data-testid="trends-bars-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="trends-bars"]').exists()).toBe(false)
  })
})
