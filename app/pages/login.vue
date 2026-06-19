<!-- app/pages/login.vue
     Standalone login — no layout, no bottom nav. Centered card. -->
<script setup lang="ts">
import { ref } from 'vue'
import { navigateTo } from '#app'

// Opt out of the default layout entirely so BottomNav never appears here.
definePageMeta({ layout: false })

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const errorMsg = ref('')

async function handleSubmit() {
  if (submitting.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    const res = await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username: username.value, password: password.value },
    })
    if ((res as any)?.ok) {
      await navigateTo('/')
    }
  } catch (err: any) {
    const status = err?.response?.status ?? err?.status ?? err?.statusCode
    if (status === 429) {
      errorMsg.value = 'Too many attempts. Please try again later.'
    } else {
      errorMsg.value = 'Invalid username or password'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-wrapper">
    <div class="login-card card">
      <!-- App wordmark -->
      <div class="login-brand">
        <span class="login-brand__name">Personal FMS</span>
        <span class="login-brand__tagline">Your money, clearly.</span>
      </div>

      <form class="login-form" novalidate @submit.prevent="handleSubmit">
        <!-- Username -->
        <div class="login-field">
          <label class="login-field__label" for="username">Username</label>
          <input
            id="username"
            v-model="username"
            class="input"
            type="text"
            autocomplete="username"
            placeholder="Enter your username"
            :disabled="submitting"
            required
          />
        </div>

        <!-- Password -->
        <div class="login-field">
          <label class="login-field__label" for="password">Password</label>
          <div class="login-field__password-wrap">
            <input
              id="password"
              v-model="password"
              class="input login-field__password-input"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="Enter your password"
              :disabled="submitting"
              required
            />
            <button
              type="button"
              class="login-field__toggle"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              :aria-pressed="showPassword"
              @click="showPassword = !showPassword"
            >
              <!-- eye / eye-off -->
              <svg v-if="!showPassword" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Error message -->
        <p v-if="errorMsg" class="login-error" role="alert">
          <!-- alert-circle -->
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {{ errorMsg }}
        </p>

        <button
          type="submit"
          class="btn-primary login-submit"
          :disabled="submitting"
        >
          {{ submitting ? 'Signing in…' : 'Log in' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-wrapper {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  padding: 24px 16px;
}

.login-card {
  width: 100%;
  max-width: 400px;
  padding: 32px 24px 28px;
  box-shadow: var(--shadow-lg);
}

/* ── Brand block ─────────────────────────────────────────── */
.login-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: 28px;
}

.login-brand__name {
  font-size: 22px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: -0.02em;
}

.login-brand__tagline {
  font-size: 13px;
  color: var(--text-muted);
  letter-spacing: .01em;
}

/* ── Form ────────────────────────────────────────────────── */
.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login-field__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

/* Password field with show/hide toggle */
.login-field__password-wrap {
  position: relative;
}

.login-field__password-input {
  padding-right: 48px;
}

.login-field__toggle {
  position: absolute;
  right: 1px;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 0 var(--radius-input) var(--radius-input) 0;
  transition: color 150ms ease-out;
}
.login-field__toggle:hover {
  color: var(--text);
}
.login-field__toggle:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}

/* ── Error ───────────────────────────────────────────────── */
.login-error {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 10px 12px;
  background: rgba(220,38,38,.08);
  border: 1px solid rgba(220,38,38,.25);
  border-radius: 10px;
  font-size: 14px;
  color: var(--negative);
  line-height: 1.4;
}

/* ── Submit ──────────────────────────────────────────────── */
.login-submit {
  width: 100%;
  margin-top: 4px;
}
</style>
