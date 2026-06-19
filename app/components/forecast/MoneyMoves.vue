<!-- app/components/forecast/MoneyMoves.vue -->
<!-- §11/§15 "Money moves" — high-value, ADVISORY action items derived server-side. -->
<!-- The app NEVER auto-moves money; the user marks each lever done/dismissed. -->
<script setup lang="ts">
import { ref } from 'vue'

interface MoneyMove {
  key: string
  kind: 'action' | 'confirm'
  title: string
  explanation: string
  suggestedAmountCents: number | null
  status: 'todo' | 'done' | 'dismissed'
}

const props = defineProps<{
  moves: MoneyMove[]
}>()

const emit = defineEmits<{ (e: 'refresh'): void }>()

// Per-key in-flight flag so buttons disable while the PATCH is running.
const busy = ref<Record<string, boolean>>({})

async function patchStatus(key: string, status: 'done' | 'dismissed' | 'todo') {
  busy.value = { ...busy.value, [key]: true }
  try {
    await $fetch(`/api/money-moves/${key}`, { method: 'PATCH', body: { status } })
    emit('refresh')
  } finally {
    busy.value = { ...busy.value, [key]: false }
  }
}
</script>

<template>
  <div class="money-moves" data-test="money-moves">
    <article
      v-for="move in props.moves"
      :key="move.key"
      class="card money-move"
      :class="{ 'money-move--done': move.status === 'done' }"
      :data-test="`money-move-${move.key}`"
      role="group"
      :aria-label="move.title"
    >
      <div class="money-move__head">
        <!-- target / lever icon -->
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true" class="money-move__icon"
        >
          <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
        </svg>
        <h3 class="money-move__title">{{ move.title }}</h3>
        <span
          v-if="move.status === 'done'"
          class="money-move__badge"
          data-test="money-move-done-badge"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
          Done
        </span>
      </div>

      <p class="money-move__explain">{{ move.explanation }}</p>

      <div v-if="move.status !== 'done'" class="money-move__actions">
        <button
          class="btn-primary money-move__btn"
          type="button"
          :disabled="busy[move.key]"
          :data-test="`money-move-done-${move.key}`"
          :aria-label="`Mark done: ${move.title}`"
          @click="patchStatus(move.key, 'done')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
          Mark done
        </button>
        <button
          class="money-move__dismiss"
          type="button"
          :disabled="busy[move.key]"
          :data-test="`money-move-dismiss-${move.key}`"
          :aria-label="`Dismiss: ${move.title}`"
          @click="patchStatus(move.key, 'dismissed')"
        >
          Dismiss
        </button>
      </div>

      <!-- Done state: quiet undo so a mistaken "done" is recoverable -->
      <button
        v-else
        class="money-move__undo"
        type="button"
        :disabled="busy[move.key]"
        :data-test="`money-move-undo-${move.key}`"
        :aria-label="`Reopen: ${move.title}`"
        @click="patchStatus(move.key, 'todo')"
      >
        Undo
      </button>
    </article>
  </div>
</template>

<style scoped>
.money-moves {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.money-move {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-left: 4px solid var(--positive);
}

.money-move--done {
  border-left-color: var(--border);
  opacity: 0.72;
}

.money-move__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.money-move__icon {
  color: var(--positive);
  flex-shrink: 0;
}

.money-move--done .money-move__icon {
  color: var(--text-muted);
}

.money-move__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
  flex: 1;
}

.money-move__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--positive);
  flex-shrink: 0;
}

.money-move__explain {
  font-size: 14px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

.money-move__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.money-move__btn {
  min-height: 44px;
  height: 44px;
  padding: 0 16px;
  font-size: 15px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.money-move__dismiss {
  min-height: 44px;
  height: 44px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-base);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: color 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.money-move__dismiss:hover:not(:disabled) {
  color: var(--text);
}
.money-move__dismiss:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.money-move__dismiss:disabled {
  opacity: 0.5;
  cursor: default;
}

.money-move__undo {
  align-self: flex-start;
  min-height: 44px;
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-base);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.money-move__undo:hover:not(:disabled) {
  color: var(--text);
}
.money-move__undo:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
</style>
