# Plan: equal workspaces, reminders from every workspace, on-time delivery

Status: implemented · 2026-09-26 · builds on the uncommitted "sync reminder history and
canvas library per workspace" work on branch `t3code/analyze-workspace-sync`.

## Goals

1. **No default workspace.** Every workspace is `scrapscache-profile-<id>` with a
   random id. Nothing in the code treats one workspace specially
   (`LOCAL_PROFILE_ID = 'device-local'` and the bare `scrapscache` database go away).
   **Local-only (private) workspaces stay fully supported.** "Local" stays what it is
   today, a workspace with no sync key. It is not "the first workspace". A private
   workspace can be created, renamed, exported, deleted and turned into a synced one,
   and a synced one can be unlinked back to private. Private and synced workspaces
   differ only in the sync features: cloud sync, pairing, and closed-app Web Push.
2. **One-time move for existing devices.** On first boot after the update, the old
   default workspace (`scrapscache` database, keyring id `device-local`) becomes an
   ordinary `scrapscache-profile-<new id>` workspace with its notes, attachments,
   boards, library, reminder history, outbox and sync state intact.
3. **Reminders work the same in every workspace.** This covers both the open
   app and closed-app Web Push:
   - The right note title shows.
   - Handled reminders stay suppressed.
   - A click opens the note in its own workspace.
4. **Cloudflare reminders arrive on time**, not about a minute late.
5. **Version 4 backups import again**, with the new `canvasLibrary` and
   `reminderHistory` fields treated as empty.

## Current state (what the code does today)

- `resolveDbName(pid)` in `src/lib/db/idb.ts`: `device-local` gets `scrapscache`;
  every other workspace gets `scrapscache-profile-<id>`.
- Special cases for `LOCAL_PROFILE_ID` / `DEVICE_DB_NAME` live in `idb.ts`,
  `syncTombstones.ts`, `stores/{sync,notes,kanban,reminders,reminderHistory,canvasLibrary}`,
  `profiles.ts` and `stores/profiles.svelte.ts`. Examples:
  - `scopedStateKey` and `SCOPED_STATE_PREFIXES` suffix state keys with `:<pid>` except
    for the default workspace.
  - localStorage mirrors (notes, boards, fired reminders) use bare keys for the
    default workspace only.
  - `clearProfileNamespace` clears the default workspace instead of dropping it.
  - `ensureProfilesLoaded` creates or adopts the `device-local` keyring entry.
- `static/sw.js` always opens `scrapscache`. Its fired-reminder ledger check and note
  lookup therefore only work for the old default workspace.
- The keyring (workspace ids, names and sync keys) is in localStorage only. The service
  worker cannot read localStorage.
- The open app's `ReminderStore` scans only the _active_ workspace's notes.
- Push wakes are published only for the active account, after its sync
  (`reminderStore.publish` → `publishReminderWakes`). A synced workspace that is not
  open stops updating its wakes on the relay.
- Cloudflare delivery: `cf/wrangler.cron.jsonc` runs `* * * * *`. `cf/cron.ts` calls
  `/api/cron/tick`, which calls `dispatchDueWakes` → `claimDueWakes(now)` with
  `fire_at <= now`. Delivery is therefore quantised to the minute tick. Any tick that
  starts a hair before a whole-minute `fireAt` pushes that reminder to the next tick.
  That is roughly 60 s late, which matches the report.

## Phase 1 — Every workspace is a profile database

1. `resolveDbName(pid)` → always `scrapscache-profile-${pid}`. Delete `DEVICE_DB_NAME`
   as a workspace database, `LOCAL_PROFILE_ID`, and every `pid === LOCAL_PROFILE_ID` branch.
2. Drop key scoping inside a workspace database. Each workspace already has its own
   database, so `scopedStateKey`, `SCOPED_STATE_PREFIXES`, `extractPidFromStateKey`
   and the "write both scoped and base key" behaviour in `getSyncState`/`setSyncState`
   are unnecessary. State keys become plain names.
3. localStorage mirrors are always keyed `<base>:<pid>` (notes, labels, boards, active
   board, board tombstones, fired-reminder mirror, sync status).
4. Fresh device: `ensureProfilesLoaded` creates a **private** workspace (empty sync
   key) with `randomOpaqueId()` and `nextProfileName`, the same as "+ New workspace".
   There is no `device-local` entry. `isLocalWorkspace(profile)` keeps meaning "has no
   sync key" and never looks at the id.
5. Deleting any workspace drops its database (`deleteProfileDatabase`), and deleting
   the last one creates a fresh empty workspace. `clearProfileNamespace` goes.
6. `notesStore`'s seed notes: shown for a brand-new workspace on a fresh device, keyed
   by a device-level flag rather than by "is the default workspace".
7. Callers of the helpers that take `(pidOrX, …)` overloads (`writeTombstones`,
   `writeLabelTombstones`, `writeKanbanState`, `writeSyncStateWithOutbox`, `putNote`, …)
   now always pass a pid, so the overloads collapse to one signature.

## Phase 2 — One-time move of the old default workspace

Runs once per device, in `ensureProfilesLoaded` before anything opens a workspace
database, under a Web Lock (`scrapscache-workspace-move`) so two tabs cannot race.

1. Detect: the keyring has an entry with id `device-local`, **or** a `scrapscache`
   database exists with notes, labels or sync state (installs that predate the keyring).
2. Pick `newId = randomOpaqueId()` and record the intent in localStorage:
   `scrapscache-workspace-move = { from: 'device-local', to: newId }`. An interrupted
   move then resumes with the same id.
3. Copy the `scrapscache` database into `scrapscache-profile-<newId>`, store by store:
   notes, labels, note images (blobs), link previews, sync state and sync outbox.
   Rename the scoped state keys to plain names while copying (Phase 1.2). This keeps:
   - the sync cursor, baseline, record ids and outbox generation, so the workspace
     does not re-upload or re-download;
   - the fired-reminder ledger and reminder history;
   - the canvas library.
4. Verify record counts per store match. Only then:
   - rewrite the keyring entry (`id: newId`, same name, sync key and `createdAt`);
   - move localStorage mirrors from bare keys to `:<newId>`;
   - repoint `scrapscache-last-active-profile`.
5. Delete the `scrapscache` database and the move marker. If the delete is blocked by
   another tab, leave the marker with a `copied` flag and finish the delete on the next
   boot. The keyring no longer names the old database, so nothing opens it.
6. Nothing changes relay-side. Account id, push subscription and wake ids depend on the
   sync key and note ids, not on the workspace id.
7. Old note links (`#note=<id>` without a workspace tag, or with the old tag) resolve
   through the existing "find the workspace holding this note" path.
   `profileForWorkspaceTag` is derived from the sync key, so tags of synced workspaces
   keep working.
8. Tests (fake-indexeddb):
   - move with data plus sync state, verifying the next sync sends zero envelopes;
   - move with no default data;
   - interrupted move resumed with the same id;
   - blocked delete finished on the next boot;
   - two tabs racing;
   - old installs without a keyring.

## Phase 3 — Reminders from every workspace, app open or closed

### 3a. A device registry the service worker can read

- New tiny IndexedDB database `scrapscache-device` with store `workspaces`, holding
  `{ id }` rows (**no sync keys, no names**). The keyring writes keep it in step
  (add, remove, move). This is the list of databases the service worker may open.
- The service worker never gets sync keys. It needs only notes, the fired ledger and
  reminder history, which are plaintext in each workspace database already.

### 3b. Service worker (`static/sw.js`)

- On `push`: read the registry, then for each workspace database:
  - look for a note whose `reminderWakeId(note.id, note.reminder) === wake.id`;
  - check its fired ledger and reminder history (`dismissedAt`, `firedAt`).
- First match wins. Claim the wake in **that** workspace's ledger (one transaction),
  then show the note title.
- If no workspace has the note (not synced to this device yet), show the generic
  notification. It claims nothing, so the app can still show the real reminder later.
- The notification data carries `{ noteId, wakeId, workspaceId }`. A click posts
  `open-note` with the workspace, or opens `/#note=<id>&ws=<tag>`, reusing the
  existing note-link switching.
- A 1.5 s budget across all databases. Lookups run in parallel, and a missing registry
  falls back to the generic notification.

### 3c. Open app: watch every workspace, not only the active one

- `ReminderStore` keeps a reminder index per workspace:
  `{ workspaceId, noteId, reminder, title, archived, trashed }`.
  - The active workspace feeds it from `notesStore`.
  - Other workspaces are read from their databases on boot, on focus, and on the
    `local-sync-complete` broadcast. Reads are metadata only, with no attachments.
- Scanning, the fired ledger and history are per workspace. `claimFired`, `learn` and
  `backfillHistory` take the workspace id instead of assuming the active one.
  Reminder history for inactive workspaces is written straight to their databases
  (`writeSyncStateWithOutbox(pid, …)`) and uploads on that workspace's next sync.
- An in-app alert shows the workspace name when it is not the open one. "Open"
  switches workspace through `profileCoordinator.switchTo` and then opens the note.
- The overdue gate (`awaitsCloud`) becomes per workspace. For a synced inactive
  workspace, `reconcile` runs a pull-only sync of that workspace in the background.
  This needs `SyncStore.sync` to run for a non-active account; today it reads
  `this.account`/`this.activePid`, so the flight takes an explicit `{ account, pid }`.

### 3d. Publishing wakes for every synced workspace

- `publishReminderWakes` and `registerReminderDevice` take the workspace's account
  instead of `syncStore.account`.
- After any workspace's sync (active or background), publish that account's wakes.
  On boot, register the push device for every synced workspace on the device.
- Private (unsynced) workspaces are otherwise equal. The only thing they can't
  have is closed-app Web Push, because push travels through the relay. While the app
  is open their reminders fire, alert, and open exactly like a synced workspace's
  (3c), and the service worker still looks them up for title and history (3b). The UI
  says so where notification settings are shown.

### 3e. Tests

- Service worker: wake matched in a second workspace; handled in workspace B's
  history, so suppressed; unknown note gives the generic notification; the click
  carries the workspace.
- `ReminderStore`: a due reminder in an inactive workspace alerts, and its "Open"
  switches workspace. History for an inactive workspace lands in its own database
  and outbox.
- Wake publishing covers every synced workspace.

## Phase 4 — On-time Cloudflare delivery

Root cause to confirm first: compare `fireAt` with the delivery time in the telemetry
(`recordReminderWake` / `telemetryQuery`) or a temporary structured log in
`dispatchDueWakes`. Expected finding: delivery lags `fireAt` by up to 60 s, clustered
near 60 s for whole-minute reminders.

Fix: exact-time scheduling, with cron kept as a safety net.

1. When `/api/sync/push/wakes` stores an account's wake snapshot, set a Durable Object
   alarm on that account's `AccountCoordinator` (`cf/accountCoordinator.ts`) for the
   earliest undelivered `fireAt`.
2. `alarm()` runs `dispatchDueWakes` for that account only, then re-arms for the
   next `fireAt`. Durable Object alarms fire within about a second and retry on failure.
3. Keep the `* * * * *` cron as a backstop sweep for missed alarms and pruning.
4. Self-hosted Node: replace the minute tick for wakes with a timer set to the next
   due wake (re-set when a snapshot is stored), and keep the existing cron endpoint
   as the backstop.
5. Tests:
   - storing a snapshot arms the alarm at the earliest wake;
   - the alarm delivers and re-arms;
   - a wake delivered by the alarm is not sent again by the cron sweep (the
     existing delivery ledger covers this).

## Phase 5 — Version 4 backups import again

`normalizeBackup` accepts `version: 4 | 5`. For version 4, `canvasLibrary` and
`reminderHistory` are empty. Exports stay version 5. Update `docs/security.md`,
and add a test that imports a version 4 fixture.

## Order and size

| Phase                  | Depends on | Risk                           | Size   |
| ---------------------- | ---------- | ------------------------------ | ------ |
| 5 v4 backups           | —          | low                            | small  |
| 4 on-time delivery     | —          | medium (Durable Object alarms) | medium |
| 1 equal workspaces     | —          | high (touches every store)     | large  |
| 2 one-time move        | 1          | high (user data)               | medium |
| 3 reminders everywhere | 1, 2       | medium                         | large  |

Suggested order: 5 → 4 (independent, ship fast) → 1 + 2 together (one change, since
Phase 1 alone would orphan existing default data) → 3.

## Verification before done

- `npm run validate` for each phase.
- Two browser profiles against the dev relay:
  - migrate a device that has default-workspace data plus a second workspace, then
    confirm sync resumes with zero re-upload;
  - reminders in the inactive workspace fire in-app, and closed-app pushes show the
    right title and open the right workspace;
  - a reminder dismissed on one device doesn't show on the other.
- Cloudflare dev (`npm run cf:dev`, or the dev deployment): measure the lag between
  `fireAt` and delivery before and after Phase 4, targeting a few seconds or less.

## Security notes (sensitive areas: sync state, workspace data, push)

- The service worker registry holds workspace ids only, never sync keys or names.
- The move copies ciphertext-free local data and changes nothing on the relay.
- Push payloads stay contentless (wake id and `fireAt`). Adding the Durable Object
  alarm doesn't change what the relay stores.

## As built (revised after review)

- **Reminder delivery on Workers** runs in a separate reminder Worker
  (`cf/reminders.ts`). Each synced account has its own `ReminderScheduler`
  Durable Object holding that account's next wake as an alarm.
  - When the alarm fires, the scheduler puts the account on the
    `scrapscache-reminder-wakes` queue. The app Worker consumes it, sends the
    account's due wakes, and sets the account's next alarm.
  - Bindings run one way only (app → schedulers → queue → app), so neither
    Worker needs the other deployed first.
  - The scheduler also sets a 10-minute retry each time it hands an account
    over; a successful delivery replaces it.
- **Every change re-arms the account.** Storing a wake snapshot or registering a
  browser for push asks for an immediate delivery run. A failed push is retried
  after a claim lease, and a run that claims a full batch runs again at once.
- **Self-hosted Node** uses one in-process timer, set when the server starts.
- **The cron** is maintenance only and runs hourly, on Workers and self-hosted
  alike. It never sends reminders, and the early-send allowance is gone.
- **Push subscriptions are per workspace.** Notifications stay one app-wide
  switch. Each synced workspace gets its own service worker registration under
  `/push/<id>/`, and so its own push address, plus a per-account device id.
  The relay already allowed one account per push address, so a shared
  subscription could only ever serve one account.

## Follow-up: independent receipts and concurrency fixes

Reminder history now uses its own encrypted endpoint, persistent queue and cursor
(see `docs/architecture.md`). It no longer travels in note-sync snapshots or uses
their outbox/lock. The relay keeps one row per note, so its storage follows the
notes with reminders rather than how often they fire. No connection is held
for receipts: workspaces exchange after a local receipt, before a missed
reminder, and at startup, focus, visibility and reconnect. On Workers, live
note-sync changes moved from SSE to a hibernating WebSocket, so an idle open
window no longer keeps a Durable Object awake. Backup restore enqueues
restored history on this channel. Existing device-wide canvas libraries are
intentionally not imported on upgrade.

Wake dispatch computes the earliest outstanding delivery, including overdue wakes
and deferred retries. A failed send waits about as long as its wake is already
overdue, from one minute up to half an hour.
The Cloudflare scheduler versions `/arm` and `/begin` requests; `/set` may finish
only the generation it began, preserving newer arms and deliveries. Canvas writes
merge both entries and deletion timestamps atomically across tabs.
