<!-- app/pages/goals.vue -->
<!-- §streak: Streaks & Milestones — derived from ledger, no new DB tables. -->
<script setup lang="ts">
import { computed } from 'vue'
import { useFetch } from '#app'

const { data: streaks, error } = await useFetch('/api/streaks')

// Format RM from sen (integer) — matches formatRM but inline since we only need simple display.
function rm(sen: number): string {
  return `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

const currentStreak = computed(() => streaks.value?.currentStreak ?? 0)
const longestStreak = computed(() => streaks.value?.longestStreak ?? 0)
const loggedToday = computed(() => streaks.value?.loggedToday ?? false)
const milestones = computed(() => streaks.value?.milestones ?? [])

// Milestone progress milestones that show a bar.
const PROGRESS_MILESTONE_KEYS = new Set(['streak-7', 'streak-30', 'ef-1000', 'ef-15000'])
</script>

<template>
  <div class="goals-page">

    <!-- ── Loading ── -->
    <template v-if="!streaks && !error">
      <div class="goals-page__skeleton" aria-label="Loading goals…" />
      <div class="goals-page__skeleton goals-page__skeleton--short" />
    </template>

    <!-- ── Error ── -->
    <div v-else-if="error" class="card goals-page__error" role="alert">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>Failed to load goals. Please try again.</span>
    </div>

    <template v-else-if="streaks">
      <!-- ── Streak Card ── -->
      <section class="goals-page__section">
        <p class="section-label">Daily streak</p>
        <div class="card streak-card">
          <!-- Flame icon -->
          <div class="streak-card__icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
              stroke-linejoin="round">
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6
                .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3
                a2.5 2.5 0 0 0 2.5 2.5z" />
            </svg>
          </div>

          <!-- Streak number -->
          <div class="streak-card__body">
            <div class="streak-card__number tabnum" aria-label="{{ currentStreak }} day streak">
              {{ currentStreak }}
            </div>
            <div class="streak-card__label">
              {{ currentStreak === 1 ? '1-day streak' : `${currentStreak}-day streak` }}
            </div>
            <div class="streak-card__longest">
              Longest: <span class="tabnum">{{ longestStreak }}</span>
              {{ longestStreak === 1 ? 'day' : 'days' }}
            </div>

            <!-- Nudge copy -->
            <p v-if="currentStreak === 0 && !loggedToday" class="streak-card__nudge">
              Start your streak — log a spend today
            </p>
            <p v-else-if="!loggedToday" class="streak-card__nudge">
              Log a spend to keep your streak alive
            </p>
          </div>
        </div>
      </section>

      <!-- ── Milestone Ladder ── -->
      <section class="goals-page__section">
        <p class="section-label">Milestones</p>
        <div class="card milestone-list">
          <div
            v-for="m in milestones"
            :key="m.key"
            class="milestone"
            :class="{ 'milestone--achieved': m.achieved, 'milestone--locked': !m.achieved }"
          >
            <!-- Icon: check or lock -->
            <div class="milestone__icon" aria-hidden="true">
              <!-- Check icon (achieved) -->
              <svg v-if="m.achieved" xmlns="http://www.w3.org/2000/svg" width="20" height="20"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" class="milestone__check-icon">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <!-- Lock icon (locked) -->
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" class="milestone__lock-icon">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>

            <!-- Text -->
            <div class="milestone__text">
              <div class="milestone__label">{{ m.label }}</div>
              <div class="milestone__detail">{{ m.detail }}</div>

              <!-- Progress bar for numeric milestones -->
              <div
                v-if="PROGRESS_MILESTONE_KEYS.has(m.key) && !m.achieved"
                class="milestone__progress"
              >
                <div
                  class="progress-track milestone__track"
                  role="progressbar"
                  :aria-valuenow="Math.round(m.progress * 100)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-label="m.label + ' progress'"
                >
                  <div
                    class="progress-fill milestone__fill"
                    :style="{ width: `${Math.round(m.progress * 100)}%` }"
                  />
                </div>
                <span class="milestone__pct tabnum">{{ Math.round(m.progress * 100) }}%</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>

  </div>
</template>

<style scoped>
.goals-page {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 16px 80px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ── Skeletons ── */
.goals-page__skeleton {
  height: 140px;
  border-radius: var(--radius-card);
  background: var(--surface-2);
  animation: shimmer 1.4s ease-in-out infinite;
}

.goals-page__skeleton--short {
  height: 320px;
}

@keyframes shimmer {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}

/* ── Error ── */
.goals-page__error {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--negative);
  font-size: 14px;
}

/* ── Section wrapper ── */
.goals-page__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── Streak Card ── */
.streak-card {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 16px;
  padding: 20px;
}

.streak-card__icon {
  color: var(--warning);
  flex-shrink: 0;
  margin-top: 2px;
}

.streak-card__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.streak-card__number {
  font-size: 48px;
  font-weight: 800;
  line-height: 1;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.streak-card__label {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.streak-card__longest {
  font-size: 13px;
  color: var(--text-muted);
}

.streak-card__nudge {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--primary);
  font-weight: 500;
}

/* ── Milestone List ── */
.milestone-list {
  padding: 0;
  overflow: hidden;
}

.milestone {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 18px;
  min-height: 44px;
  border-bottom: 1px solid var(--border);
}

.milestone:last-child {
  border-bottom: none;
}

.milestone__icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.milestone--achieved .milestone__icon {
  background: color-mix(in srgb, var(--positive) 15%, transparent);
  color: var(--positive);
}

.milestone--locked .milestone__icon {
  background: var(--surface-2);
  color: var(--text-muted);
}

.milestone__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.milestone__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.milestone--locked .milestone__label {
  color: var(--text-muted);
}

.milestone--achieved .milestone__label {
  color: var(--text);
}

.milestone__detail {
  font-size: 12px;
  color: var(--text-muted);
}

/* ── Progress bar inside milestone ── */
.milestone__progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.milestone__track {
  flex: 1;
  height: 6px;
  border-radius: var(--radius-track);
  background: var(--surface-2);
}

.milestone__fill {
  height: 100%;
  border-radius: var(--radius-track);
  background: var(--primary);
  transition: width 0.4s ease;
  min-width: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .milestone__fill {
    transition: none;
  }
}

.milestone__pct {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  min-width: 3ch;
  text-align: right;
}
</style>
