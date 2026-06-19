<!-- app/layouts/default.vue
     Default authenticated layout: top header (app name + logout) + page slot + bottom nav.
     Login page bypasses this layout entirely (uses definePageMeta({ layout: false })). -->
<script setup lang="ts">
import { navigateTo } from '#app'
import BottomNav from '~/components/BottomNav.vue'

async function handleLogout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
}
</script>

<template>
  <div class="app-shell">
    <!-- Top header -->
    <header class="app-header">
      <span class="app-header__name">Personal FMS</span>
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
    </header>

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
  height: 52px;
  padding: 0 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  /* subtle elevation so content scrolls under it */
  box-shadow: 0 1px 0 var(--border), 0 2px 8px rgba(15,23,42,.04);
  padding-top: env(safe-area-inset-top, 0px);
}

.app-header__name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
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

/* ── Page content ─────────────────────────────────────────── */
.app-content {
  flex: 1;
  /* bottom padding: 56px nav + safe-area + small buffer */
  padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
}
</style>
