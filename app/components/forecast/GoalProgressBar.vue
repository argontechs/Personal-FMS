<!-- app/components/forecast/GoalProgressBar.vue -->
<!-- §7: EF + Kill-Card progress bars. progress is [0,1]; targetCents is the goal ceiling. -->
<script setup lang="ts">
import { computed } from 'vue'
import { formatRM } from '../../../shared/types'

const props = defineProps<{
  label: string
  currentCents: number
  targetCents: number
  progress: number
}>()

const pct = computed(() => Math.round(props.progress * 100))

// EF uses positive green; Kill-Card uses primary blue
const isEf = computed(() => props.label.toLowerCase().includes('emergency') || props.label.toLowerCase().includes('ef'))
</script>

<template>
  <div class="goal-progress card">
    <div class="goal-progress__header">
      <span class="goal-progress__label">{{ label }}</span>
      <span class="goal-progress__pct tabnum">{{ pct }}%</span>
    </div>
    <div
      class="progress-track goal-progress__track"
      role="progressbar"
      :aria-valuenow="pct"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="label"
    >
      <div
        class="progress-fill goal-progress__fill"
        :class="isEf ? 'progress-fill--savings' : 'progress-fill--kill-card'"
        :style="{ width: pct + '%' }"
      />
    </div>
    <div class="goal-progress__amounts">
      <span class="goal-progress__current tabnum">{{ formatRM(currentCents) }}</span>
      <span class="goal-progress__target tabnum">of {{ formatRM(targetCents) }}</span>
    </div>
  </div>
</template>

<style scoped>
.goal-progress {
  padding: 16px 20px;
}

.goal-progress__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.goal-progress__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.goal-progress__pct {
  font-size: 14px;
  font-weight: 700;
  color: var(--primary);
}

.goal-progress__track {
  margin-bottom: 10px;
}

.goal-progress__amounts {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.goal-progress__current {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.goal-progress__target {
  font-size: 13px;
  color: var(--text-muted);
}
</style>
