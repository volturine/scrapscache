# Scraps Cache — UI Audit Issue List

- Worktree: `/Users/kripso/.t3/worktrees/scrapscache/t3code-2c9a360c`
- Audited: 2026-09-28 via 4 read-only subagents + manual scans
- Dev server: `http://100.89.41.114:5173` (running)
- Evidence: screenshots under `/var/folders/c4/kpvbqywn7v35qcclqq60vy9m0000gn/T/opencode/`
- Nothing has been changed yet. Proposed dispositions in the last column await confirmation.

Legend: sev = severity (high/med/low) · decision = propose fix / hold / fold-in

## Group 1 — Consistent design

| #   | sev  | location                                                                               | issue                                                                                                                                                            | decision                              |
| --- | ---- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | HIGH | `src/routes/mcp/authorize/+page.svelte:57-248`                                         | Page built from ~30 local `css()` one-offs, off the shared registry: duplicate icon sizes, custom "eyebrow", raw `letterSpacing: '-0.02em'`, raw mono font stack | fix                                   |
| 2   | MED  | `panda/styles.ts:1225`                                                                 | `workspaceStyles.iconButton` hard-codes 30×30px, no focus ring, supersedes `iconButton` recipe                                                                   | fix                                   |
| 3   | MED  | `panda/styles.ts:1233`                                                                 | `workspacePanelBtn.danger` hand-rolls destructive button unlike `button({variant:'destructive'})`                                                                | fix                                   |
| 4   | MED  | `panda/styles.ts:542`                                                                  | `pwaStyles.iosDone` hand-rolls a primary button                                                                                                                  | fix                                   |
| 5   | MED  | `KanbanCard.svelte:58`, `KanbanCardBody.svelte:31`                                     | Kanban card `rounded:'dialog'` vs feed card `rounded:'card'`; `KanbanCardBody` re-copies `noteCard` slot-recipe markup                                           | fix                                   |
| 6   | MED  | `panda/styles.ts:590`                                                                  | Section-header counts `opacity:.6` ≈ 2.6:1 contrast in light mode                                                                                                | fix                                   |
| 7   | LOW  | `panda/theme.ts`, `panda/styles.ts:1662`, `Sidebar.svelte:300`, `panda/styles.ts:1015` | Four competing eyebrow/overline treatments for same label kind                                                                                                   | fix (unify to `textStyle:'overline'`) |
| 8   | LOW  | `(app)/+layout.svelte:369`, `ui.svelte.ts:23`                                          | Raw `#1a1a1a`/`#ffffff` hex duplication                                                                                                                          | fix                                   |
| 9   | LOW  | `panda/styles.ts:2611-2864`                                                            | Markdown styles use ad-hoc `em`/`rem` sizes off the type scale                                                                                                   | fix                                   |
| 10  | LOW  | `panda/recipes.ts:597`                                                                 | Checked checklist rows `opacity:.5`, borderline legibility on colored cards                                                                                      | fix                                   |
| 11  | LOW  | `panda/styles.ts:1585`                                                                 | Empty-state CTA re-styled to pill; doesn't match other secondary buttons                                                                                         | fix                                   |

## Group 2 — Mobile

| #   | sev  | location                                                                     | issue                                                                                                                    | decision |
| --- | ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| 12  | HIGH | `src/lib/editContext.ts:15`                                                  | `crypto.randomUUID` missing on insecure origins → every app route 500s over LAN/Tailscale HTTP (phone access impossible) | fix      |
| 13  | HIGH | `src/app.html:7`                                                             | `maximum-scale=1, user-scalable=no` blocks Android pinch-zoom                                                            | fix      |
| 14  | MED  | `Topbar.svelte:236+`, `NoteEditorFooter.svelte:821+`, `panda/recipes.ts:246` | Topbar + editor-footer icon buttons 32×32 — sub-44px tap targets                                                         | fix      |
| 15  | MED  | `DatePickerViews.svelte:27`, `ReminderCalendar.svelte:175,203`               | Calendar: 28×28 month nav, 32×32 day cells, 21px-tall Today/Clear                                                        | fix      |
| 16  | MED  | `KanbanView.svelte:358,428`                                                  | Kanban filter buttons 36×36 / 40×28                                                                                      | fix      |
| 17  | LOW  | `Topbar.svelte:247`, `NoteEditor.svelte`                                     | Search input 190×30; editor title field 25px tall                                                                        | fix      |
| 18  | LOW  | `BottomNav.svelte`                                                           | Nav funnels through 32×32 hamburger; no bottom tab bar (design judgment)                                                 | hold     |

Overflow: clean at 360/390/768 + landscape on all 11 routes. Zoom: layout intact at 150/200%.

## Group 3 — Every state

| #   | sev  | location                                                                       | issue                                                                                                                           | decision          |
| --- | ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 19  | HIGH | `SyncModal.svelte:938-1108`                                                    | "Back/Cancel" link-buttons: no hover, no pressed, no disabled look despite `disabled={busy}`                                    | fix               |
| 20  | MED  | `panda/recipes.ts:106`                                                         | `buttonRecipe` has no `_active` (pressed) state                                                                                 | fix               |
| 21  | MED  | SyncModal, dialogs, `LabelMenu`, drawer                                        | No enter/exit transitions on modals/popovers. View-transition idea = hold; **modal/popover transitions = fix** (split decision) | fix (modals only) |
| 22  | MED  | `panda/styles.ts:644-792`                                                      | Attachment/canvas/photo delete "×" + file-preview open button: no hover/active                                                  | fix               |
| 23  | MED  | `SyncModal.svelte:914,1015`                                                    | Register/link form errors missing `role="alert"`                                                                                | fix               |
| 24  | MED  | `admin/+page.svelte:99-107,180,195`                                            | Admin errors only as global banner (not inline at fields), no save success feedback, no sign-in busy state                      | fix               |
| 25  | LOW  | `(app)/+layout.svelte:302`                                                     | View/tab switches are hard swaps, no transition                                                                                 | hold              |
| 26  | LOW  | `admin/+page.svelte:180`                                                       | "Loading…" static text, no skeleton                                                                                             | fix               |
| 27  | LOW  | `TurnstileWidget.svelte:55`                                                    | Blank 65px box while challenge iframe loads                                                                                     | fold-in           |
| 28  | LOW  | `KanbanCard.svelte:55`, `TrashView.svelte:25`, `mcp/authorize+page.svelte:374` | Drag affordance cursor-only; trash empty state no CTA; disabled Approve no visible reason                                       | fold-in           |

## Group 4 — Before launch

| #   | sev | location                  | issue                                                                                              | decision |
| --- | --- | ------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| 29  | MED | `NotesHomeView.svelte:27` | No one-line value proposition on the home screen; only meta description states what the product is | fix      |

Launch agent output was partly garbled; titles/favicons "all clean" claims to be re-verified manually during fixes.

## Group 5 — Use it like a real user

Report arrived just before the stuck processes were killed; findings folded in below. Full report: `/var/folders/c4/kpvbqywn7v35qcclqq60vy9m0000gn/T/opencode/realuser-AUDIT-REPORT.md`

| #   | sev  | location                                                                         | issue                                                                                                                   | decision      |
| --- | ---- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| G1  | HIGH | `SyncModal.svelte:547-551,570`                                                   | Escape cannot close the Workspaces modal (Ark dialog `closeOnEscape={false}` + app handler bails on `defaultPrevented`) | fix           |
| G2  | MED  | `ReminderPicker.svelte:161-165`, `reminderNotify.ts:105-113`                     | "Save" hangs with zero feedback while the browser permission prompt is unanswered                                       | fix           |
| G3  | MED  | `BodyEditor` / `NoteEditor`                                                      | Editor body is a Tab trap; keyboard users have no path to footer actions (Attach/Labels/Archive/Delete)                 | fix           |
| G4  | MED  | `Topbar.svelte:327-410`, `ReminderNotificationSettings.svelte:33-49`             | Settings menu broken keyboard nav: plain button inside Menu.Content, arrow keys dead, first Esc swallowed               | fix           |
| G5  | MED  | `KanbanCard.svelte:51-67`, `panda/styles.ts:2135-2153`, `panda/recipes.ts:75-79` | Kanban cards + sidebar rows show no visible keyboard focus ring                                                         | fix           |
| G6  | LOW  | `Topbar.svelte:370-373`                                                          | Plain buttons mixed into Menu.Content break menu semantics (root cause of G4)                                           | fix (with G4) |
| G7  | LOW  | `svelte.config.js:50`                                                            | CSP `font-src 'self'` blocks all Excalidraw fonts (~30 console errors per canvas open)                                  | fix           |
| G8  | LOW  | `src/lib/utils.ts:95-103`                                                        | New note in /reminders seeds an already-overdue reminder                                                                | fix           |
| G9  | LOW  | `NoteEditorFooter.svelte:955-957`                                                | Footer "Done" button is dead code (`onClose` never wired)                                                               | fix           |
| G10 | LOW  | `SyncModal.svelte` (pairing copy)                                                | Pairing 60s expiry copy is clear; "Sync now" fine — no action, verified working                                         | —             |

Core flows verified working end-to-end with mouse/touch: notes, checklists, markdown, links, photos, canvas, labels, kanban drag, reminders, backups export (.scraps-cache-backup), sync register/pair/timeout feedback. No nav 404s. Keyboard-only pass: broken per G1,G3,G4,G5.

## Summary

## Summary

- 39 issues total (29 + 10 group-5) · propose fixing 37 · hold 2 (18 bottom tab bar, 25 view transitions)
- Fix order plan: 12 (crash) → 13 → recipes/styles registry work (1–11, 19–24) → tap targets (14–17) → group-5 keyboard/interaction fixes → 26–29 → re-verify

## Resolution (2026-09-28)

All 37 proposed fixes implemented and verified. Validation: svelte-check 0 errors · 1514/1514 tests · build clean.

- #12 fixed with a guarded writer-id fallback in `src/lib/model/edit.ts` + regression test (`edit.writer.test.ts`)
- #13 fixed in `src/app.html`
- #1–#11, #19–#24, #26–#28 fixed across `panda/recipes.ts`, `panda/styles.ts`, and the named components; `mcp/authorize` now consumes the new `mcpAuthorizeStyles` registry
- #14–#17: icon buttons keep desktop size but grow to ~44px touch targets under `pointer: coarse` (new `_touch` condition + `touchHit` in `panda/recipes.ts`); calendar cells 2.25rem/15rem grid; kanban filters and Today/Clear raised to `sm`/2rem; topbar search 2.5rem on mobile
- #20 `button` recipe gained `_active`; icon buttons gained `_disabled`
- #21 dialog slot recipe animates (backdrop `fadeIn`, panel `swapIn`); `popover` contract animates
- Group-5: G1 Esc closes SyncModal (window handler no longer trusts Ark's synthetic `defaultPrevented`; `WorkspaceRow` claims its Escapes with `stopPropagation` — 37/37 SyncModal tests pass); G2 reminder Save shows the permission-prompt wait; G4/G6 settings rows are real `Menu.Item`s; G7 Excalidraw fonts self-hosted at `static/fonts` (CSP untouched); G8 reminder seeding can no longer be born overdue (+3 tests); G9 footer Done wired; G5 focus rings on `menuItem` + kanban cards + hover lift
- #29 value proposition line added to the home empty state (`EmptyState` `tagline` prop)
- #18 (bottom tab bar) and #25 (view transitions) held by design, as agreed
- DESIGN.md written (the design contract the checklist asks for)
- New tests: `edit.writer.test.ts` (2), `utils.reminder.test.ts` (+3); updated: PwaInstallSettings/ReminderNotificationSettings tests to real Menu context

Keyboard verification (live, headless Chrome): Ctrl+/ creates a note, typing persists, Esc closes the editor; Esc closes the Workspaces modal; Esc closes the settings menu; no console errors on any route (the ~30 CSP font failures per canvas open are gone).

Held by design decision: note-body keeps its caret on Escape (Tab indents by design); card quick actions remain reachable via context-menu key after Esc.

## Post-audit scope correction (2026-09-28)

Only the MCP **UI** was removed at the owner's direction: the `/mcp/authorize` consent page and its `mcpAuthorizeStyles` registry contracts (the page had no in-app entry point). The MCP **functionality** was retained in full: `src/lib/mcpHandshake.ts` (protocol crypto), the sync store's `getMcpWorkspaceStatuses()` probe, `mcpWorkspaceGrant()` in profiles, the self-hostable server under `recipes/mcp-server`, `docker/compose.mcp.yaml`, `docs/mcp.md`, and all MCP CI deploy/image jobs. An initial over-removal of the whole feature was caught and reverted from git before any commit.
