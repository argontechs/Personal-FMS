<!-- app/pages/login.vue -->
<!-- iPhone-first login page — single column, centered, max 480px. -->
<script setup lang="ts">
import { ref } from 'vue'
import { navigateTo } from '#app'

const username = ref('')
const password = ref('')
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
    <div class="login-card">
      <h1 class="login-title">Personal FMS</h1>
      <p class="login-subtitle">Sign in to continue</p>

      <form class="login-form" @submit.prevent="handleSubmit">
        <div class="field">
          <label class="field__label" for="username">Username</label>
          <input
            id="username"
            v-model="username"
            class="field__input"
            type="text"
            autocomplete="username"
            placeholder="Username"
            :disabled="submitting"
            required
          />
        </div>

        <div class="field">
          <label class="field__label" for="password">Password</label>
          <input
            id="password"
            v-model="password"
            class="field__input"
            type="password"
            autocomplete="current-password"
            placeholder="Password"
            :disabled="submitting"
            required
          />
        </div>

        <p v-if="errorMsg" class="login-error" role="alert">{{ errorMsg }}</p>

        <button
          type="submit"
          class="login-btn"
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
  background: #f4f6fb;
  padding: 24px 16px;
}

.login-card {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 32px 24px;
}

.login-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 4px;
  text-align: center;
}

.login-subtitle {
  font-size: 0.875rem;
  color: #64748b;
  text-align: center;
  margin: 0 0 28px;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field__label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #1e293b;
}

.field__input {
  height: 44px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 1rem;
  color: #1e293b;
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
}

.field__input:focus {
  border-color: #2563eb;
}

.field__input:disabled {
  background: #f8fafc;
  color: #94a3b8;
}

.login-error {
  font-size: 0.875rem;
  color: #dc2626;
  margin: 0;
  padding: 10px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
}

.login-btn {
  height: 48px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  margin-top: 4px;
}

.login-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
