<!-- app/layouts/default.vue
     Default authenticated layout: top header (app name + settings + logout) + page slot + bottom nav.
     Login page bypasses this layout entirely (uses definePageMeta({ layout: false })). -->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { navigateTo } from '#app'
import BottomNav from '~/components/BottomNav.vue'
import { deadLetterCount, useOfflineQueue } from '~/composables/useOfflineQueue'

async function handleLogout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
}

function handleSettings() {
  navigateTo('/settings')
}

// ── Offline indicator ────────────────────────────────────────────────────────
const isOffline = ref(false)

function handleOnline() { isOffline.value = false }
function handleOffline() { isOffline.value = true }

onMounted(() => {
  isOffline.value = !navigator.onLine
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
})

onUnmounted(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
})

// ── Dead-letter banner actions ────────────────────────────────────────────────
const { flush, readDeadLetterItems } = useOfflineQueue()

/** Retry: clear dead-letter store and re-enqueue items, then flush. */
async function retryDeadLetters() {
  const items = await readDeadLetterItems()
  if (!items.length) return
  // Open the DB to wipe the dead-letter store, then re-enqueue each item
  const { openDB } = await import('idb')
  const db = await openDB('money-fms', 2)
  for (const item of items) {
    await db.delete('dead_txns', item.uuid)
    // Re-put into pending with reset attempt counter
    await db.put('pending_txns', { ...item, attempts: 0, nextRetryAt: 0, deadLetteredAt: undefined })
  }
  deadLetterCount.value = 0
  await flush()
}

/** Discard: silently remove all dead-lettered items. */
async function discardDeadLetters() {
  const { openDB } = await import('idb')
  const db = await openDB('money-fms', 2)
  const items = await db.getAll('dead_txns')
  for (const item of items) {
    await db.delete('dead_txns', item.uuid)
  }
  deadLetterCount.value = 0
}
</script>

<template>
  <div class="app-shell">
    <!-- Top header -->
    <header class="app-header">
      <span class="app-header__name">Personal FMS</span>
      <div class="app-header__actions">
        <!-- Settings gear icon -->
        <button
          class="app-header__icon-btn"
          type="button"
          aria-label="Settings"
          @click="handleSettings"
        >
          <!-- Lucide settings (gear) icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <!-- Log out button -->
        <button
          class="app-header__logout"
          type="button"
          aria-label="Log out"
          @click="handleLogout"
        >
          <!-- log-out icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span class="app-header__logout-label">Log out</span>
        </button>
      </div>
    </header>

    <!-- Offline indicator -->
    <div
      v-if="isOffline"
      class="sync-banner sync-banner--offline"
      role="status"
      aria-live="polite"
    >
      <!-- wifi-off icon -->
      <svg class="sync-banner__icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
      </svg>
      <span>You're offline — changes will sync when reconnected</span>
    </div>

    <!-- Dead-letter sync warning banner -->
    <div
      v-if="deadLetterCount > 0"
      class="sync-banner sync-banner--warn"
      role="status"
      aria-live="polite"
    >
      <!-- alert-circle icon -->
      <svg class="sync-banner__icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span class="sync-banner__msg">
        {{ deadLetterCount }} {{ deadLetterCount === 1 ? 'entry' : 'entries' }} couldn't sync
      </span>
      <button class="sync-banner__action" type="button" @click="retryDeadLetters">Retry</button>
      <button class="sync-banner__action sync-banner__action--ghost" type="button" @click="discardDeadLetters">Discard</button>
    </div>

    <!-- Page content — padded-bottom so nothing hides behind the nav -->
    <main class="app-content">
      <slot />
    </main>

    <!-- Bottom tab bar -->
    <BottomNav />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--bg);
}

/* ── Top header ──────────────────────────────────────────── */
.app-header {
  position: sticky;
  top: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 54px;
  padding: 0 var(--gutter);
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  backdrop-filter: saturate(140%) blur(12px);
  -webkit-backdrop-filter: saturate(140%) blur(12px);
  border-bottom: 1px solid var(--border);
  padding-top: env(safe-area-inset-top, 0px);
}

.app-header__name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.015em;
}

.app-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.app-header__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 150ms ease-out, background 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.app-header__icon-btn:hover {
  color: var(--primary);
  background: var(--surface-2);
}
.app-header__icon-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.app-header__logout {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 36px;
  padding: 0 10px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-base);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color 150ms ease-out, border-color 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.app-header__logout:hover {
  color: var(--negative);
  border-color: var(--negative);
}
.app-header__logout:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.app-header__logout-label {
  /* hide on very small screens if needed; always visible at 375px */
  font-size: 13px;
}

/* ── Sync / offline banners ───────────────────────────────── */
.sync-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  /* reduced-motion: no animation — just appears/disappears */
}

.sync-banner--offline {
  background: var(--surface-2, #f1f5f9);
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}

.sync-banner--warn {
  background: #fefce8;
  color: #92400e;
  border-bottom: 1px solid #fde68a;
}

/* dark-mode: invert the amber tones */
@media (prefers-color-scheme: dark) {
  .sync-banner--warn {
    background: rgba(234, 179, 8, 0.12);
    color: #fbbf24;
    border-bottom-color: rgba(234, 179, 8, 0.25);
  }
}

.sync-banner__icon {
  flex-shrink: 0;
}

.sync-banner__msg {
  flex: 1;
}

.sync-banner__action {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1.5px solid currentColor;
  background: transparent;
  color: inherit;
  font-family: var(--font-base);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 120ms ease-out;
}
.sync-banner__action:hover {
  opacity: 0.75;
}
.sync-banner__action:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.sync-banner__action--ghost {
  border-color: transparent;
  opacity: 0.7;
}
.sync-banner__action--ghost:hover {
  opacity: 1;
}

/* ── Page content ─────────────────────────────────────────── */
.app-content {
  flex: 1;
  /* bottom padding: nav height + safe-area + comfortable buffer (optically ≥ top) */
  padding-bottom: calc(84px + env(safe-area-inset-bottom, 0px));
}

/* ── Desktop app-frame ────────────────────────────────────────
   On wide screens, float a phone-width column inside a subtle elevated frame
   over an ambient gradient backdrop — so desktop reads as intentional, not
   an empty void. Mobile single-column is untouched (frame only ≥ 760px). */
@media (min-width: 760px) {
  .app-shell {
    max-width: 460px;
    margin: 24px auto;
    min-height: calc(100dvh - 48px);
    border-radius: 28px;
    border: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    background: var(--surface);
  }
  /* Ambient backdrop behind the frame */
  body {
    background:
      radial-gradient(120% 80% at 50% -10%, color-mix(in srgb, var(--primary) 10%, var(--bg)) 0%, var(--bg) 55%),
      var(--bg);
  }
  .app-header {
    border-radius: 28px 28px 0 0;
  }
}
</style>
