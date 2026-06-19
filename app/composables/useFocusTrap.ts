// app/composables/useFocusTrap.ts
// Shared accessibility focus-trap for bottom sheets / dialogs.
//
// While `active` is true, for the element in `containerRef`:
//   (a) moves focus to the first focusable element on open (respects an existing
//       autofocus / focused element already inside the container),
//   (b) traps Tab / Shift+Tab within the container (last → first, first → last),
//   (c) closes on Escape via the provided onEscape callback,
//   (d) restores focus to the element that was focused before the trap opened
//       (the trigger) on close,
//   (e) marks the rest of the document inert + aria-hidden so AT/Tab can't reach it.
//
// Explicit imports only (Nuxt auto-import fails under vitest).
import { watch, nextTick, onBeforeUnmount, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => {
    // Skip elements that are hidden / not laid out.
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    // offsetParent is null for display:none; happy-dom returns null too, so we
    // only treat an explicit hidden attribute / disabled as non-focusable and
    // otherwise trust the selector (keeps the trap testable in happy-dom).
    return true
  })
}

export interface FocusTrapOptions {
  /** Reactive open/closed state of the dialog. */
  active: Ref<boolean>
  /** Ref to the dialog container (the [role="dialog"] element). */
  containerRef: Ref<HTMLElement | null>
  /** Called when Escape is pressed while the trap is active. */
  onEscape?: () => void
  /**
   * Optional ref to the element that should receive initial focus. If omitted
   * (or its target isn't focusable yet), the first focusable element wins.
   */
  initialFocusRef?: Ref<HTMLElement | { $el?: HTMLElement } | null>
}

export function useFocusTrap(opts: FocusTrapOptions) {
  const { active, containerRef, onEscape, initialFocusRef } = opts

  // The element focused immediately before the trap opened — restored on close.
  let previouslyFocused: HTMLElement | null = null
  // Siblings of the container we marked inert, so we can undo exactly those.
  let inertedSiblings: HTMLElement[] = []

  function resolveInitial(): HTMLElement | null {
    const raw = initialFocusRef?.value
    if (!raw) return null
    if (raw instanceof HTMLElement) return raw
    // Component instance with $el
    const el = (raw as { $el?: HTMLElement }).$el
    return el instanceof HTMLElement ? el : null
  }

  function markBackgroundInert(container: HTMLElement) {
    inertedSiblings = []
    // Inert every sibling of the container within its parent. This handles both
    // teleported sheets (parent = body, siblings = the app root + other portals)
    // and inline sheets (parent = the page root, siblings = the page content).
    const parent = container.parentElement
    if (!parent) return
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue
      if (child === container) continue
      if (child.hasAttribute('inert') || child.getAttribute('aria-hidden') === 'true') continue
      child.setAttribute('inert', '')
      child.setAttribute('aria-hidden', 'true')
      inertedSiblings.push(child)
    }
  }

  function clearBackgroundInert() {
    for (const el of inertedSiblings) {
      el.removeAttribute('inert')
      el.removeAttribute('aria-hidden')
    }
    inertedSiblings = []
  }

  function onKeydown(e: KeyboardEvent) {
    if (!active.value) return
    // Real browsers send 'Escape'; older IE/Edge sent 'Esc'. (vue-test-utils'
    // `.esc` shorthand dispatches key:'esc', so match case-insensitively.)
    const key = e.key?.toLowerCase()
    if (key === 'escape' || key === 'esc') {
      e.preventDefault()
      onEscape?.()
      return
    }
    if (e.key !== 'Tab') return
    const container = containerRef.value
    if (!container) return
    const focusables = focusableWithin(container)
    if (focusables.length === 0) {
      // Nothing focusable — keep focus on the container itself.
      e.preventDefault()
      container.focus()
      return
    }
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const activeEl = container.ownerDocument?.activeElement as HTMLElement | null

    if (e.shiftKey) {
      // Shift+Tab on the first (or outside) wraps to the last.
      if (activeEl === first || !container.contains(activeEl)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      // Tab on the last (or outside) wraps to the first.
      if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  function open() {
    const container = containerRef.value
    if (!container) return
    const doc = container.ownerDocument
    previouslyFocused =
      (doc?.activeElement as HTMLElement | null) ?? null

    markBackgroundInert(container)
    doc?.addEventListener('keydown', onKeydown, true)

    // Move focus inside: respect an explicit initial-focus target if focusable,
    // otherwise the first focusable element, otherwise the container itself.
    const initial = resolveInitial()
    const focusables = focusableWithin(container)
    const target =
      (initial && container.contains(initial) ? initial : null) ??
      focusables[0] ??
      container
    if (target === container && !container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1')
    }
    ;(target as HTMLElement).focus()
  }

  function close() {
    const container = containerRef.value
    const doc = container?.ownerDocument ?? (typeof document !== 'undefined' ? document : null)
    doc?.removeEventListener('keydown', onKeydown, true)
    clearBackgroundInert()
    // Restore focus to the trigger.
    const restore = previouslyFocused
    previouslyFocused = null
    if (restore && typeof restore.focus === 'function') {
      restore.focus()
    }
  }

  watch(
    active,
    (isActive) => {
      if (isActive) {
        // Wait for the dialog DOM (v-if) to render before grabbing focus.
        nextTick(open)
      } else {
        close()
      }
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => {
    if (active.value) close()
  })
}
