<!-- app/pages/trends.vue
     Trends over time — net worth / card balance line, net-worth sparkline, spend-by-category bars.
     Data comes from GET /api/trends (snapshot series + category breakdown). READ-ONLY view.
     Reachable from the Goals screen ("View trends" link) — NOT a 6th bottom tab.
     Explicit imports; SFC; SVG icons only; auth is global (no definePageMeta middleware). -->
<script setup lang="ts">
import { computed } from 'vue'
import { useFetch } from '#app'
import TrendCharts from '../components/trends/TrendCharts.vue'

const { data: trends, error } = await useFetch('/api/trends')

const series = computed(() => (trends.value as any)?.series ?? [])
const spendByCategory = computed(() => (trends.value as any)?.spendByCategory ?? [])
</script>

<template>
  <div class="trends-page">
    <header class="trends-page__header">
      <NuxtLink to="/goals" class="trends-page__back" aria-label="Back to goals">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </NuxtLink>
      <h1 class="trends-page__title">Trends</h1>
    </header>

    <!-- ── Loading ── -->
    <template v-if="!trends && !error">
      <div class="trends-page__skeleton" aria-label="Loading trends…" />
      <div class="trends-page__skeleton trends-page__skeleton--short" />
    </template>

    <!-- ── Error ── -->
    <div v-else-if="error" class="card trends-page__error" role="alert">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>Failed to load trends. Please try again.</span>
    </div>

    <!-- ── Charts ── -->
    <TrendCharts v-else :series="series" :spend-by-category="spendByCategory" />
  </div>
</template>

<style scoped>
.trends-page {
  max-width: 460px;
  margin: 0 auto;
  padding: 20px var(--gutter) 88px;
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
}

.trends-page__header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.trends-page__back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: var(--text);
  text-decoration: none;
  background: var(--surface-2);
}
.trends-page__back:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.trends-page__title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text);
  margin: 0;
}

.trends-page__skeleton {
  height: 160px;
  border-radius: var(--radius-card);
  background: var(--surface-2);
  animation: shimmer 1.4s ease-in-out infinite;
}
.trends-page__skeleton--short {
  height: 280px;
}

@keyframes shimmer {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}

.trends-page__error {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--negative);
  font-size: 14px;
  padding: 16px;
}
</style>
