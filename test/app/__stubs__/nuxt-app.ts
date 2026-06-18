// test/app/__stubs__/nuxt-app.ts
// Minimal shim for Nuxt's #app module used when mounting pages in Vitest.
// useFetch returns { data: Ref<T> } matching Nuxt's runtime contract so templates unwrap correctly.
import { ref } from 'vue'

export async function useFetch(_url: string, _opts?: any) {
  return { data: ref(null), refresh: async () => {} }
}

export function useRuntimeConfig() {
  return { public: {} }
}

export function defineNuxtComponent(component: any) {
  return component
}

export function defineNuxtPlugin(setup: () => void) {
  return setup
}
