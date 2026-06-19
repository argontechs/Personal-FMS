# Personal FMS — Design System (v1.1)

> Trustworthy-fintech aesthetic (per ui-ux-pro-max): trust-blue + profit-green, IBM Plex Sans, high contrast, generous whitespace, an oversized hero number, SVG icons only. **Avoid: playful styling, AI purple/pink gradients, emoji-as-icons, low-contrast gray-on-gray.** Mobile-first (iPhone), accessible (WCAG AA, 44px touch targets), RM currency. Every screen applies these tokens — define them ONCE in `app/assets/css/tokens.css` (imported globally via nuxt.config `css`) and reference the CSS variables; no per-component hex.

## Color tokens (light — default)
```css
:root {
  --bg:            #F5F7FB;   /* app background (soft neutral) */
  --surface:       #FFFFFF;   /* cards */
  --surface-2:     #F0F3F9;   /* insets, chips, track */
  --border:        #E2E8F0;   /* hairlines */
  --text:          #0F172A;   /* primary text (≈16:1 on surface) */
  --text-muted:    #64748B;   /* secondary (≥4.5:1 on surface) */
  --primary:       #1E40AF;   /* trust blue — primary actions, links */
  --primary-700:   #1B3A9B;
  --on-primary:    #FFFFFF;
  --positive:      #059669;   /* green — income, savings, "good", EF growth */
  --negative:      #DC2626;   /* red — debt, shortfall, "you're short" */
  --warning:       #D97706;   /* amber — utilisation ≥90%, near-limit */
  --ring:          #1E40AF;   /* focus ring */
  --shadow:        0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(15,23,42,.06);
  --shadow-lg:     0 8px 30px rgba(15,23,42,.10);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0B1220; --surface:#131C2E; --surface-2:#1B2638; --border:rgba(255,255,255,.08);
    --text:#F1F5F9; --text-muted:#94A3B8; --primary:#3B82F6; --primary-700:#2563EB; --on-primary:#0B1220;
    --positive:#34D399; --negative:#F87171; --warning:#FBBF24; --ring:#3B82F6;
    --shadow:0 1px 2px rgba(0,0,0,.3); --shadow-lg:0 8px 30px rgba(0,0,0,.45);
  }
}
```
Semantic use: **green = money in / saved / progress**, **red = owed / over / short**, **amber = warning**. Never use color alone — pair with an icon or label.

## Typography — IBM Plex Sans
`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap')` (with `font-display: swap`; system-font fallback stack `-apple-system, "IBM Plex Sans", system-ui, sans-serif` so text shows instantly).
- **Hero number** (Safe-to-Spend, balances): 40–56px, weight 700, `letter-spacing:-0.02em`, **tabular-nums** (`font-variant-numeric: tabular-nums`) so RM figures don't jitter.
- Section title (h2): 18px / 600. Card label: 13px / 600 / uppercase / `letter-spacing:.04em` / `--text-muted`. Body: 16px / 400 / line-height 1.5. Numeric values: 15–16px / 600 / tabular-nums.
- All money rendered via the existing `formatRM` (thousands separators, 2dp).

## Spacing / radius / motion
- Spacing scale (4/8): 4, 8, 12, 16, 24, 32. Screen gutter 16px. Card padding 20px. Gap between cards 16px.
- Radius: card 16px, button/input 12px, chip 999px (pill), progress track 999px.
- Elevation: cards use `--shadow`; sheets/modals `--shadow-lg`. One consistent scale — no ad-hoc shadows.
- Motion: 150–250ms, ease-out enter / ease-in exit; press = scale 0.97; respect `prefers-reduced-motion`. Animate transform/opacity only.

## Components
- **Card**: `background:var(--surface); border-radius:16px; box-shadow:var(--shadow); padding:20px`. Section label (uppercase muted) + content.
- **Button (primary)**: `background:var(--primary); color:var(--on-primary); height:48px; border-radius:12px; font-weight:600`; pressed scale 0.97; disabled opacity .5. One primary CTA per screen.
- **Input**: height 48px, 16px text (prevents iOS zoom), 12px radius, 1px `--border`, focus → 2px `--ring`. Visible `<label>` above (never placeholder-only). `inputmode`/`type` correct (numeric for amounts, password toggle on login).
- **Category chip**: pill, ≥44px tall, SVG icon (Lucide) + label; selected = `--primary` bg / `--on-primary`; unselected = `--surface-2` / `--text`. 8px gap, wrap.
- **Progress bar**: track `--surface-2`, fill `--positive` (EF/savings) or `--primary` (kill-card); height 8px; rounded; show % + amount; animate width via transform-friendly approach; `role="progressbar"` + aria values.
- **List row** (transactions): icon (category) + name/note + date (muted) on left, signed amount on right (negative=`--text`, income=`--positive`); ≥56px tall; swipe or trailing edit/delete; tabular-nums amounts.
- **Bottom tab bar** (NEW — app now has multiple screens): fixed bottom, safe-area-inset padding, ≤5 items, icon + label, active item `--primary`. Items: **Home** (dashboard), **Activity** (transactions), **Budgets**, **Goals** (EF/streaks). Settings/logout via a header menu, not the tab bar.
- **Badge/pill**: small status (e.g. "93% — near limit" amber, "0% BT active" green, streak count). Icon + text.
- **Empty state**: icon + one-line message + a clear action (e.g. "No spending logged yet — tap + to add").

## Icons (Lucide SVG — one family, 1.75px stroke, 24px default)
Categories: Food=`utensils`, Transport=`bus`, Fuel=`fuel`, Groceries=`shopping-basket`, Shopping=`shopping-bag`, Bills=`receipt`, Other=`circle-dollar-sign`. Nav: Home=`home`, Activity=`list`, Budgets=`wallet`, Goals=`target`. Actions: edit=`pencil`, delete=`trash-2`, logout=`log-out`. Use an inline-SVG approach (no emoji, no icon-font). Provide `aria-label` on icon-only controls.

## Accessibility / quality bar (enforce on every screen)
44×44px min touch targets + 8px spacing; focus rings visible; contrast ≥4.5:1; color never the sole signal; `prefers-reduced-motion` honored; tabular-nums on all money; safe-area insets for the fixed bottom nav and any bottom CTA; one primary CTA per screen; destructive actions (delete) in red and separated, with an undo affordance.
