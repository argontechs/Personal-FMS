<!-- app/components/trends/TrendCharts.vue
     Hand-rolled inline-SVG trend charts (NO chart library). Pure presentational component:
     takes a snapshot `series` + `spendByCategory` and renders
       1. a net-worth / card-balance line chart (the card line "going down" is the motivator),
       2. a net-worth sparkline,
       3. a spend-by-category bar set,
       4. an accessible data table fallback (toggle).
     Empty state (<2 snapshot points) is handled here so the page can pass raw data through.
     Explicit imports only; SFC (no string template); SVG icons only. -->
<script setup lang="ts">
import { computed, ref } from 'vue'

interface SnapshotPoint {
  date: string
  netWorthCents: number
  totalDebtCents: number
  cardBalanceCents: number
  efBalanceCents: number
  liquidCents: number
}
interface CategorySpend { category: string; amountCents: number }

const props = defineProps<{
  series: SnapshotPoint[]
  spendByCategory: CategorySpend[]
}>()

// ── Formatting ────────────────────────────────────────────────────────────────
function rm(sen: number): string {
  const neg = sen < 0
  const abs = Math.abs(sen)
  const whole = Math.round(abs / 100)
  return `${neg ? '-' : ''}RM${whole.toLocaleString('en-US')}`
}
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(d)} ${months[Number(m) - 1]}`
}
const CATEGORY_LABELS: Record<string, string> = {
  food: 'Food', transport: 'Transport', car: 'Car', fuel: 'Fuel',
  groceries: 'Groceries', shopping: 'Shopping', bills: 'Bills', other: 'Other',
}
function catLabel(c: string): string {
  return CATEGORY_LABELS[c] ?? (c.charAt(0).toUpperCase() + c.slice(1))
}

// <2 points → nothing meaningful to draw.
const hasData = computed(() => props.series.length >= 2)

// ── Line-chart geometry (net worth + card balance) ──────────────────────────────
const VBW = 320 // viewBox width
const VBH = 120 // viewBox height
const PAD = { top: 8, right: 8, bottom: 8, left: 8 }

function buildPath(values: number[], minV: number, maxV: number): string {
  if (values.length < 2) return ''
  const range = maxV - minV || 1
  const innerW = VBW - PAD.left - PAD.right
  const innerH = VBH - PAD.top - PAD.bottom
  return values
    .map((v, i) => {
      const x = PAD.left + (i / (values.length - 1)) * innerW
      const y = PAD.top + innerH - ((v - minV) / range) * innerH
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

const netWorthVals = computed(() => props.series.map((p) => p.netWorthCents))
const cardVals = computed(() => props.series.map((p) => p.cardBalanceCents))

// Net-worth line uses its own scale (so the shape is readable).
const nwMin = computed(() => Math.min(...netWorthVals.value))
const nwMax = computed(() => Math.max(...netWorthVals.value))
const netWorthPath = computed(() => buildPath(netWorthVals.value, nwMin.value, nwMax.value))

// Card-balance line uses its own scale.
const cardMin = computed(() => Math.min(...cardVals.value))
const cardMax = computed(() => Math.max(...cardVals.value))
const cardPath = computed(() => buildPath(cardVals.value, cardMin.value, cardMax.value))

// Sparkline reuses the net-worth path on a flatter viewBox.
const SPARK_H = 40
function buildSpark(values: number[]): string {
  if (values.length < 2) return ''
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const range = maxV - minV || 1
  const innerW = VBW - 4
  const innerH = SPARK_H - 8
  return values
    .map((v, i) => {
      const x = 2 + (i / (values.length - 1)) * innerW
      const y = 4 + innerH - ((v - minV) / range) * innerH
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
const sparkPath = computed(() => buildSpark(netWorthVals.value))

// First/last for delta callouts.
const firstPoint = computed(() => props.series[0])
const lastPoint = computed(() => props.series[props.series.length - 1])
const netWorthDelta = computed(() =>
  hasData.value ? lastPoint.value.netWorthCents - firstPoint.value.netWorthCents : 0,
)
const cardDelta = computed(() =>
  hasData.value ? lastPoint.value.cardBalanceCents - firstPoint.value.cardBalanceCents : 0,
)

// ── Spend-by-category bars ──────────────────────────────────────────────────────
const maxCatCents = computed(() =>
  props.spendByCategory.reduce((m, c) => Math.max(m, c.amountCents), 0),
)
function barPct(amountCents: number): number {
  if (maxCatCents.value <= 0) return 0
  return Math.round((amountCents / maxCatCents.value) * 100)
}
const hasCategories = computed(() => props.spendByCategory.length > 0)

// ── A11y data-table toggle ──────────────────────────────────────────────────────
const showTable = ref(false)
function toggleTable() {
  showTable.value = !showTable.value
}
</script>

<template>
  <!-- ── Empty state: <2 snapshot points ── -->
  <div v-if="!hasData" class="trend-empty card" data-testid="trends-empty">
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
      stroke-linejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
    <p class="trend-empty__title">Trends build up as you use the app</p>
    <p class="trend-empty__sub">Check back in a few days — we snapshot your net worth, debts and card
      balance once a day, and the charts appear once there are at least two days of history.</p>
  </div>

  <div v-else class="trend-charts" data-testid="trends-charts">
    <!-- ── Net worth + card balance line chart ── -->
    <section class="trend-section">
      <div class="trend-section__head">
        <p class="section-label">Net worth &amp; card balance</p>
        <button type="button" class="trend-table-toggle" data-testid="trends-table-toggle"
          :aria-expanded="showTable" @click="toggleTable">
          {{ showTable ? 'Hide data table' : 'Show data table' }}
        </button>
      </div>

      <div class="card trend-card">
        <div class="trend-legend">
          <span class="trend-legend__item">
            <span class="trend-legend__swatch trend-legend__swatch--nw" aria-hidden="true" />
            Net worth
            <span class="trend-legend__delta tabnum"
              :class="netWorthDelta >= 0 ? 'is-up' : 'is-down'">
              {{ netWorthDelta >= 0 ? '▲' : '▼' }} {{ rm(Math.abs(netWorthDelta)) }}
            </span>
          </span>
          <span class="trend-legend__item">
            <span class="trend-legend__swatch trend-legend__swatch--card" aria-hidden="true" />
            Card
            <span class="trend-legend__delta tabnum"
              :class="cardDelta <= 0 ? 'is-up' : 'is-down'">
              {{ cardDelta <= 0 ? '▼' : '▲' }} {{ rm(Math.abs(cardDelta)) }}
            </span>
          </span>
        </div>

        <svg class="trend-line" :viewBox="`0 0 ${VBW} ${VBH}`" preserveAspectRatio="none"
          role="img" data-testid="trends-line"
          :aria-label="`Net worth from ${rm(firstPoint.netWorthCents)} to ${rm(lastPoint.netWorthCents)}; card balance from ${rm(firstPoint.cardBalanceCents)} to ${rm(lastPoint.cardBalanceCents)} over ${series.length} days`">
          <path :d="netWorthPath" class="trend-line__nw" fill="none" />
          <path :d="cardPath" class="trend-line__card" fill="none" />
        </svg>

        <div class="trend-axis">
          <span class="tabnum">{{ shortDate(firstPoint.date) }}</span>
          <span class="tabnum">{{ shortDate(lastPoint.date) }}</span>
        </div>
      </div>
    </section>

    <!-- ── Net-worth sparkline ── -->
    <section class="trend-section">
      <p class="section-label">Net worth trend</p>
      <div class="card trend-card trend-card--spark">
        <div class="trend-spark__value tabnum">{{ rm(lastPoint.netWorthCents) }}</div>
        <svg class="trend-spark" :viewBox="`0 0 ${VBW} ${SPARK_H}`" preserveAspectRatio="none"
          role="img" data-testid="trends-spark"
          :aria-label="`Net worth sparkline, latest ${rm(lastPoint.netWorthCents)}`">
          <path :d="sparkPath" class="trend-spark__path" fill="none" />
        </svg>
      </div>
    </section>

    <!-- ── Spend-by-category bars ── -->
    <section class="trend-section">
      <p class="section-label">Spend by category</p>
      <div class="card trend-card">
        <div v-if="hasCategories" class="trend-bars" data-testid="trends-bars">
          <div v-for="c in spendByCategory" :key="c.category" class="trend-bar-row">
            <span class="trend-bar-row__label">{{ catLabel(c.category) }}</span>
            <div class="trend-bar-row__track"
              role="progressbar"
              :aria-valuenow="barPct(c.amountCents)"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="`${catLabel(c.category)}: ${rm(c.amountCents)}`">
              <div class="trend-bar-row__fill" :style="{ width: `${barPct(c.amountCents)}%` }" />
            </div>
            <span class="trend-bar-row__value tabnum">{{ rm(c.amountCents) }}</span>
          </div>
        </div>
        <p v-else class="trend-bars__empty" data-testid="trends-bars-empty">
          No spending recorded in this window yet.
        </p>
      </div>
    </section>

    <!-- ── A11y data table (toggleable text fallback for the charts) ── -->
    <section v-if="showTable" class="trend-section" data-testid="trends-table">
      <p class="section-label">Data table</p>
      <div class="card trend-card trend-card--table">
        <table class="trend-data-table">
          <caption class="sr-only">Daily snapshot of net worth, total debt, card balance and emergency fund</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Net worth</th>
              <th scope="col">Total debt</th>
              <th scope="col">Card</th>
              <th scope="col">EF</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in series" :key="p.date">
              <td class="tabnum">{{ shortDate(p.date) }}</td>
              <td class="tabnum">{{ rm(p.netWorthCents) }}</td>
              <td class="tabnum">{{ rm(p.totalDebtCents) }}</td>
              <td class="tabnum">{{ rm(p.cardBalanceCents) }}</td>
              <td class="tabnum">{{ rm(p.efBalanceCents) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.trend-charts {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
}

.trend-section {
  display: flex;
  flex-direction: column;
  gap: var(--label-gap);
}

.trend-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.trend-table-toggle {
  background: none;
  border: none;
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 2px;
  cursor: pointer;
  min-height: 32px;
}
.trend-table-toggle:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: 6px;
}

.trend-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.trend-card--spark {
  gap: 8px;
}
.trend-card--table {
  padding: 0;
  overflow-x: auto;
}

/* ── Legend ── */
.trend-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  color: var(--text-muted);
}
.trend-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.trend-legend__swatch {
  width: 14px;
  height: 3px;
  border-radius: 2px;
  display: inline-block;
}
.trend-legend__swatch--nw { background: var(--primary); }
.trend-legend__swatch--card { background: var(--warning); }
.trend-legend__delta {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.trend-legend__delta.is-up { color: var(--positive); }
.trend-legend__delta.is-down { color: var(--negative); }

/* ── Line chart ── */
.trend-line {
  width: 100%;
  height: 120px;
  display: block;
}
.trend-line__nw {
  stroke: var(--primary);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.trend-line__card {
  stroke: var(--warning);
  stroke-width: 2;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.trend-axis {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Sparkline ── */
.trend-spark__value {
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.trend-spark {
  width: 100%;
  height: 40px;
  display: block;
}
.trend-spark__path {
  stroke: var(--positive);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ── Bars ── */
.trend-bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.trend-bar-row {
  display: grid;
  grid-template-columns: 84px 1fr auto;
  align-items: center;
  gap: 10px;
}
.trend-bar-row__label {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.trend-bar-row__track {
  height: 10px;
  border-radius: var(--radius-track);
  background: var(--surface-2);
  overflow: hidden;
}
.trend-bar-row__fill {
  height: 100%;
  border-radius: var(--radius-track);
  background: var(--primary);
  min-width: 2px;
  transition: width 0.4s ease;
}
.trend-bar-row__value {
  font-size: 13px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 5ch;
  text-align: right;
}
.trend-bars__empty {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}

/* ── Data table ── */
.trend-data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.trend-data-table th,
.trend-data-table td {
  padding: 8px 10px;
  text-align: right;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
}
.trend-data-table th:first-child,
.trend-data-table td:first-child {
  text-align: left;
}
.trend-data-table thead th {
  color: var(--text-muted);
  font-weight: 600;
  position: sticky;
  top: 0;
  background: var(--surface);
}
.trend-data-table tbody tr:last-child td {
  border-bottom: none;
}

/* ── Empty state ── */
.trend-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 36px 24px;
  color: var(--text-muted);
}
.trend-empty__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin: 4px 0 0;
}
.trend-empty__sub {
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  max-width: 36ch;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .trend-bar-row__fill { transition: none; }
}
</style>
