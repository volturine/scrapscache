# Scraps Cache — Design System

One design system, two themes, no raw values in components. This document is the
contract; `panda/theme.ts` is its implementation, and every color, font size,
spacing and corner radius in the app resolves to a token defined there.

## Where things live

| What                                          | Where                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Tokens (colors, sizes, radii, spacing, type)  | `panda/theme.ts`                                                                      |
| Shared control/surface recipes                | `panda/recipes.ts`                                                                    |
| Named visual contracts (per component family) | `panda/styles.ts` — the single registry, imported via `$panda/styles`                 |
| One-off tweaks                                | `css()` next to the markup that owns them; never a named contract in a `.svelte` file |

Components never hard-code palette hexes, px values, or parallel CSS custom
properties. If a value has no token, the question is why — usually it should
join the scale, not become a literal.

## Color

Semantic aliases only (`scrapscache.*`); each carries a light and dark value:

- **Base:** `bg`, `surface`, `surfaceSubtle`, `border`, `borderSubtle`, `borderFaint`
- **Text:** `text`, `textMuted` (the only two copy colors; never opacity-fade text for contrast)
- **Accent:** `accent`, `accentHover`, `accentForeground`, `accentSubtle`
- **Status:** `danger` (+`Subtle`, `Hover`, `Foreground`), `warning`, `success`, `overdue`
- **Controls:** `interactiveHover`, `interactiveActive`, `controlSubtle`, `controlSubtleHover`
- **On media (photos, canvases, video):** `media*` tokens — dark glass surfaces and white text that work over any image, in both themes
- **Focus:** `focus` ring color, 2px, `outlineOffset: 2px` (−2px inside menus)
- **On coloured notes:** `onNote.*` — the `noteSurface` recipe re-points
  `textMuted`, `badgeText`, `overdue`, `accent` and `focus` to these inside every
  coloured note, so components keep using the `scrapscache.*` names and still meet
  4.5:1 (3:1 for focus) on every note colour; `theme.contrast.test.ts` checks it

Theme switch is a `dark` class on `<html>`; `mode()` in `panda/theme.ts` pairs
every value. Nothing else branches on theme.

## Type

The Google Sans Variable stack is bundled; no other font face exists. Sizes come
from the `fontSizes` scale and are consumed through text styles, not raw
`fontSize` values:

- **Copy:** `body` (14), `bodyMuted`, `subtitle` (16), `compact` (13)
- **Controls & UI copy:** `button`, `label` (12), `caption` (11), `micro` (10)
- **Headings:** `title` → `heading` → `display` → `editorTitle`; page titles `pageTitle`/`pageTitleWide`
- **Eyebrow labels:** `overline` — the one uppercase tracked treatment. No
  component may re-build its own uppercase-caption eyebrow.

Relative `em` sizes inside markdown render blocks are intentional: they scale
with the block they live in, using one shared ladder (h1 1.35em → h3 1.05em).

## Spacing & radius

- Spacing scale: `3xs` (2px) `2xs` (4) `xs` (6) `sm` (8) `md` (12) `lg` (16) `xl` (20) `2xl` (24) `3xl` (32) `4xl` (40) `page`/`pageWide`/`list`/`action`
- Radii: `compact` (6) `control` (8) `card` (12) `dialog` (16) `sheet` (24) `row` (10) `pill`
- One object kind, one radius: note cards are `card` wherever they appear
  (feed, kanban board included). Controls are `control`; dialogs `dialog`.

## Controls

Every button comes from `styled-system/recipes`: `button` (primary, secondary,
quiet, subtle, ghost, danger, destructive, dashed — sizes xs/sm/md) or
`iconButton` (haze variants over media, ghost, danger — sizes xs→lg). No
hand-rolled lookalikes: if a control looks like a button, it uses the recipe,
and its hover, pressed (`_active` scale), disabled and focus-visible states come
with it. Icon buttons keep their compact visual size and grow to a ~44px touch
target under `pointer: coarse` via the shared `touchHit` expansion.

Text-only navigation links that must sit on a button grid use the `linkAction`
contract in `styles.ts` — same feedback contract at text weight.

Menus use `menuItem` (with `feedback: 'none'` only for passive rows); inputs use
`input`; badges `badge`; dialogs the `dialog` slot recipe (which carries the
backdrop fade and panel rise).

## States

- Every destructive or consequential action has hover, pressed, and disabled
  treatments — either from a recipe or explicitly in its registry contract.
- Disabled is `opacity` + `not-allowed`; busy buttons change their label
  ("Saving…", "Signing in…") rather than appearing dead.
- Errors render next to what caused them with `role="alert"`; confirmations use
  `role="status"`.
- Every list view owns an `EmptyState` (icon, description, optional one-line
  value proposition, one CTA). Loading surfaces show skeletons, not blank
  boxes; the first paint is covered by `app.html`'s inline theme script.

## Motion

Shared keyframes: `cardIn`, `swapIn`/`swapOut`, `fadeIn`/`fadeOut`. Dialog
panels rise and scale from 0.96 over 200ms with a decelerating curve; backdrops
fade 180ms; popovers use `swapIn` at 140ms. Transitions name the properties they
move — never `transition: all`. Hover feedback only under `_hoverable` so touch
devices don't stick.

## Accessibility contracts

- Keyboard: every dialog closes on Escape (owned by its own handler); the note
  body returns Tab at its outermost caret positions so the footer stays
  reachable; menus keep arrow-key roving focus across all their items.
- Focus is always visible: ring on controls, ring on cards and rows.
- Touch targets reach ~44px on coarse pointers without changing desktop layout.
