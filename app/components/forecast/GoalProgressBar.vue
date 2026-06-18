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
</script>

<template>
  <div class="goal-progress">
    <div class="goal-progress__header">
      <span class="goal-progress__label">{{ label }}</span>
      <span class="goal-progress__pct">{{ pct }}%</span>
    </div>
    <div class="goal-progress__track" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" :aria-label="label">
      <div class="goal-progress__fill" :style="{ width: pct + '%' }" />
    </div>
    <div class="goal-progress__amounts">
      <span class="goal-progress__current">{{ formatRM(currentCents) }}</span>
      <span class="goal-progress__target">/ {{ formatRM(targetCents) }}</span>
    </div>
  </div>
</template>

<style scoped>
.goal-progress {
  background: #fff;
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.goal-progress__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.goal-progress__label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #444;
}

.goal-progress__pct {
  font-size: 0.85rem;
  font-weight: 700;
  color: #2c5282;
}

.goal-progress__track {
  height: 8px;
  background: #e8edf5;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.goal-progress__fill {
  height: 100%;
  background: linear-gradient(90deg, #4a90d9, #2c5282);
  border-radius: 4px;
  transition: width 0.4s ease;
  min-width: 2px;
}

.goal-progress__amounts {
  display: flex;
  gap: 4px;
  align-items: baseline;
}

.goal-progress__current {
  font-size: 0.9rem;
  font-weight: 700;
  color: #1a1a2e;
}

.goal-progress__target {
  font-size: 0.78rem;
  color: #aaa;
}
</style>
