<!-- app/components/BottomNav.vue
     Fixed bottom tab bar with 4 tabs: Home / Activity / Budgets / Goals.
     Active tab = --primary; ≥44px touch targets; safe-area-inset-bottom padding.
     NOT rendered on /login (layout handles this). -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from '#app'

const route = useRoute()
const active = computed(() => route.path)
</script>

<template>
  <nav class="bottom-nav" aria-label="Main navigation">
    <NuxtLink to="/" class="bottom-nav__tab" :class="{ 'bottom-nav__tab--active': active === '/' }" aria-label="Home">
      <!-- home -->
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
      <span class="bottom-nav__label">Home</span>
    </NuxtLink>

    <NuxtLink to="/activity" class="bottom-nav__tab" :class="{ 'bottom-nav__tab--active': active === '/activity' }" aria-label="Activity">
      <!-- list -->
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <line x1="8" y1="6" x2="21" y2="6"/>
        <line x1="8" y1="12" x2="21" y2="12"/>
        <line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/>
        <line x1="3" y1="12" x2="3.01" y2="12"/>
        <line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
      <span class="bottom-nav__label">Activity</span>
    </NuxtLink>

    <NuxtLink to="/accounts" class="bottom-nav__tab" :class="{ 'bottom-nav__tab--active': active === '/accounts' }" aria-label="Accounts">
      <!-- landmark (Lucide) -->
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <line x1="3" y1="22" x2="21" y2="22"/>
        <line x1="6" y1="18" x2="6" y2="11"/>
        <line x1="10" y1="18" x2="10" y2="11"/>
        <line x1="14" y1="18" x2="14" y2="11"/>
        <line x1="18" y1="18" x2="18" y2="11"/>
        <polygon points="12 2 20 7 4 7"/>
      </svg>
      <span class="bottom-nav__label">Accounts</span>
    </NuxtLink>

    <NuxtLink to="/budgets" class="bottom-nav__tab" :class="{ 'bottom-nav__tab--active': active === '/budgets' }" aria-label="Budgets">
      <!-- wallet -->
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
        <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
      </svg>
      <span class="bottom-nav__label">Budgets</span>
    </NuxtLink>

    <NuxtLink to="/goals" class="bottom-nav__tab" :class="{ 'bottom-nav__tab--active': active === '/goals' }" aria-label="Goals">
      <!-- target -->
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
      <span class="bottom-nav__label">Goals</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: stretch;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: saturate(140%) blur(12px);
  -webkit-backdrop-filter: saturate(140%) blur(12px);
  border-top: 1px solid var(--border);
  box-shadow: 0 -1px 0 var(--border), 0 -6px 20px hsl(var(--shadow-color) / 0.06);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.bottom-nav__tab {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 58px;
  padding: 9px 4px;
  color: var(--text-muted);
  text-decoration: none;
  transition: color 200ms ease-out, transform 200ms cubic-bezier(.34,1.56,.64,1);
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.bottom-nav__tab:active {
  transform: scale(0.93);
}

.bottom-nav__tab--active {
  color: var(--primary);
}

/* Active indicator pill above the icon — clearly distinct active tab */
.bottom-nav__tab--active::before {
  content: '';
  position: absolute;
  top: 6px;
  width: 26px;
  height: 3px;
  border-radius: 999px;
  background: var(--primary);
}

.bottom-nav__tab:hover {
  color: var(--text);
}
.bottom-nav__tab--active:hover {
  color: var(--primary);
}

.bottom-nav__tab:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
  border-radius: 10px;
}

.bottom-nav__label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .01em;
  line-height: 1;
}

/* Desktop: pin the nav inside the floating app-frame, not the full viewport */
@media (min-width: 760px) {
  .bottom-nav {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    width: 460px;
    bottom: 24px;
    border-radius: 0 0 28px 28px;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }
}
</style>
