# Architecture

Scraps Cache is a **single-page notes client** plus an optional **opaque sync relay**.
The same SvelteKit app serves the UI and the sync API when self-hosted.

## High-level layout

```text
┌────────────────────────────────────────────────────────────┐
│  Browser (PWA)                                             │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────────┐  │
│  │ UI (Svelte 5)│  │ Stores      │  │ IndexedDB         │  │
│  │ routes +     │◄─┤ notes/sync  │◄─┤ notes, outbox,    │  │
│  │ components   │  │ kanban/ui   │  │ attachments, …    │  │
│  └──────────────┘  └──────┬──────┘  └───────────────────┘  │
│                           │ encrypt / decrypt locally      │
└───────────────────────────┼────────────────────────────────┘
                            │ HTTPS (opaque envelopes)
┌───────────────────────────▼────────────────────────────────┐
│  SvelteKit API (Node or Cloudflare Workers)                │
│  ┌────────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ /api/sync/*    │  │ rate limit  │  │ platform store  │  │
│  │ pair / delta / │──┤ auth        │──┤ local libSQL or │  │
│  │ register / …   │  │ metrics     │  │ D1 + R2 + DO    │  │
│  └────────────────┘  └─────────────┘  └─────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

## Design principles

1. **Offline-first** — IndexedDB is the durable source of truth on each device.
2. **Ciphertext relay** — the server stores slots of encrypted blobs; it never
   receives note plaintext, labels, or attachment bytes.
3. **Native deployment** — self-hosting uses two local sqld stores; Cloudflare
   uses D1 metadata, R2 ciphertext objects, and a per-account Durable Object.
4. **Client-side crypto** — sync keys, backup passphrases, and encryption live
   in the browser using audited primitives (`@noble/*`, CPace).

## Client

| Area           | Location                                                   | Responsibility                                                  |
| -------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Routes / pages | `src/routes/`                                              | Notes home, kanban, reminders, archive, trash, labels           |
| Components     | `src/lib/components/`                                      | Editors, feed, sidebar, sync UI, backup dialogs                 |
| Note model     | `src/lib/model/`                                           | Note types, edits, merge, body CRDT; shared with the MCP server |
| Notes state    | `src/lib/stores/notes.svelte.ts`                           | CRUD, search, trash, labels                                     |
| Sync state     | `src/lib/stores/sync.svelte.ts`                            | Keyring, open workspace, sync status per workspace              |
| Relay client   | `src/lib/relayClient.ts`                                   | Sign-ins and requests, per account                              |
| Sync engine    | `src/lib/relaySync.ts`, `src/lib/workspaceSync.ts`         | One sync of a workspace: relay delta, database read and save    |
| Sync scheduler | `src/lib/stores/syncScheduler.ts`                          | When each workspace syncs; one lane per workspace               |
| Device pairing | `src/lib/deviceLink.ts`                                    | Rendezvous and sealed key handover                              |
| Kanban         | `src/lib/stores/kanban.svelte.ts`, `src/lib/kanban.ts`     | Boards and columns                                              |
| IndexedDB      | `src/lib/db/idb.ts`                                        | Persistence, outbox, replace/import; one database per workspace |
| Workspaces     | `src/lib/profiles.ts`, `src/lib/stores/profiles.svelte.ts` | Sync-key keyring, workspace switching, dataset handover         |
| Sync crypto    | `src/lib/syncPairing.ts`                                   | Identity, pairing PAKE, payload encrypt/decrypt                 |
| Sync records   | `src/lib/syncRecords.ts`                                   | Envelope packing, tombstones                                    |
| Backups        | `src/lib/backup.ts`, `backupCrypto.ts`                     | Export/import encrypted `.scraps-cache-backup`                  |
| Images         | `src/lib/imageOptimize.ts`                                 | Resize, WebP, strip EXIF before store/sync                      |
| App viewport   | `src/lib/appViewport.ts`                                   | Safe area + keyboard frame; overlay host                        |
| Reminder wakes | `src/lib/server/wakeDispatch.ts`, `webPush.ts`             | Contentless Web Push ticks; SW finds the note in any workspace  |

### Local data model (conceptual)

- **Notes** — title, body (plain text + checklist lines), color, pins, archive,
  trash, reminder timestamp and how it repeats, label IDs, attachments. Every change goes through
  `applyNoteEdit` in `src/lib/model/`, which stamps only the fields it changes,
  on the relay-corrected clock. The body is also a Yjs document: concurrent edits
  on the same body base merge. First edits of a text-only copy identify that base
  by its body write stamp and contents. A newer text-only snapshot creates one full
  replacement shared by every receiving device. Across replacement bases, the
  latest body write wins. Attachments merge by id with removals remembered;
  other fields are last-write-wins per field, ties broken by writer.
- **Reminder wakes** — optional account-scoped opaque wake IDs and `fireAt`
  timestamps. A repeating reminder's times are worked out on each device from its
  first time and repeat (in the time zone it was set in, so every device agrees);
  a device that syncs sends the next 60 days of them, one wake per time. Each enabled device has independent delivery state, and a device
  does not need the encrypted note before receiving a generic alert. The relay
  never receives note IDs or text.
- **Reminder history** — encrypted receipts on a separate channel,
  `/api/sync/reminders`, with one relay row per note: the note's latest
  receipts, keyed by when each reminder was due and merged by the earliest
  dismissal. Storage follows the number of notes with reminders, not how often
  they fire. An upload replaces only a row its device has already seen;
  otherwise that row comes back, is merged, and is sent again, so every device
  converges without losing receipts. Every linked workspace has its own durable
  receipt queue and cursor. Dismissing an alert never starts or waits for note
  sync, even in the active workspace. Nothing stays connected and nothing
  polls: the client sends immediately after a local write, and exchanges before
  showing a missed reminder and when the app starts, is shown again or comes
  back online. Every synced workspace catches up there, whichever one a window
  shows. A dismissal on one device therefore clears the other
  device's alert the next time that device is looked at, not instantly.
  Failures retry with backoff, except a full account, which waits for the next
  change. System notifications
  write into the same local queue; with the app closed, receipts upload when it
  next opens. Backups include history. A note deleted after it had receipts
  gets an encrypted deletion marker that erases them and rejects stale offline
  uploads.
- **Labels** — named tags with update timestamps for conflict resolution.
- **Boards** — kanban structures + tombstones for cross-device deletion.
- **Canvas library** — the workspace's reusable Excalidraw shapes, one record per
  item. The newest version of an item wins, and a delete wins over every version
  it saw. An open canvas editor picks up changes from other devices. Local writes
  merge with persisted entries and tombstones in one transaction across tabs.
- **Sync outbox** — changed record keys scheduled for upload (not a full
  mirror of every field into `localStorage`).
- **Unsaved changes** — every change to a note, label, board or library item is
  written to a journal in `localStorage` in one synchronous step before its save
  to IndexedDB starts, and taken out once that save has landed
  (`src/lib/pendingJournal.ts`). A start replays what is left through the ordinary
  merging save, so a change outlives the app being stopped before its save
  finished, deletes included. A save that fails is tried again, later each time.
  The journal comes first when `localStorage` is short of room: the fast-start
  copy of the notes, which only makes a start quicker, is dropped for it.
- **Attachments** — full bytes loaded when needed; grid/list may keep thumbnails
  only in memory. A picked photo is re-encoded on the way in; a picked file that
  is not (a video, a document) is refused over 8 MB, since the relay takes 16 MB of
  ciphertext per envelope and the bytes travel base64-encoded twice. A photo's
  place in the body is a marker line (`src/lib/photoMarker.ts`) that leaves with
  the photo and comes back with an undo. "Download" hands the bytes to the share
  sheet in the app (iOS offers Save Image there) and to a download on the web.

### Sync identity

From a random 32-byte sync key the client derives:

- an Ed25519 signing key; only its public key is registered with the relay
- `accountId` — the stable v1 server-visible account handle derived from the sync key
- One-time pairing code — random 80-bit rendezvous code, shown only while connecting another device

Payload encryption key material is also derived from the sync key. The server
verifies signed one-time challenges and issues 30-minute sessions, but cannot
decrypt envelopes.

### Workspaces

A device can hold several **workspaces**. Each one owns its own isolated
dataset, so datasets never mix and switching is a pointer change plus an
in-memory reload rather than a copy. Every workspace is either private (no sync
key, never talks to the relay) or synced, and any workspace can move between the
two without its notes moving:

- **Sync this workspace** registers a fresh sync key for that same workspace.
- **Unlink** drops the sync key on this device and keeps the notes as a private
  workspace; the cloud copy and other devices are untouched.
- **Delete cloud data** deletes the relay account, then unlinks.
- **Delete workspace** removes it and its notes from this device. Deleting the
  last workspace leaves a fresh empty one.

Every workspace uses its own `scrapscache-profile-<id>` database, and none is
special: a fresh device starts with one private workspace created like any
other.

A small device database, `scrapscache-device`, lists the workspaces by id and
one-way link tag, never by name or sync key, and caches link previews. The
service worker reads it to find which workspace a reminder push belongs to.

Reminders are equal across workspaces. Receipts of handled reminders are
exchanged for every synced workspace at the same moments, whichever one is open. While the app is open it watches every
workspace, not only the open one: a due reminder from another workspace alerts
with that workspace's name, and opening it switches there. Each workspace keeps
its own fired ledger and synced history. With the app closed, the relay pushes
a synced workspace's wakes to every browser registered under its account; the
service worker finds the note in that workspace, shows its title, and skips a
reminder any device already handled. Private workspaces get the same alerts
while the app is open; only closed-app push needs the relay.

Everything written on a device goes to that workspace's database straight away,
together with a mark in its upload queue. Sync is then one thing only: sending
what a database holds to the relay and saving what the relay holds into it, in the
background. Which workspace a window shows has no part in it, so switching
workspace neither waits for a sync nor disturbs one. The window is a view: it
writes to the database, and shows what a sync saved once it is saved.

When a workspace syncs is decided in one place, the sync scheduler
(`src/lib/stores/syncScheduler.ts`). The stores only say what happened ("this
workspace changed", "sync now", "this rewrites the workspace"); the scheduler
applies the same rules to every workspace on the device:

1. Every workspace syncs from its own database (`src/lib/workspaceSync.ts`),
   whether or not a window has it open.
2. Each workspace has one lane. A lane is asked to sync, runs rounds until it has
   settled with the relay, and gives everyone who asked meanwhile the same answer.
   One round of a workspace runs at a time, under a lock of its own shared by
   every window. Workspaces do not wait for each other, and none interrupts
   another: a long upload in one never holds up, or is restarted by, another.
3. Only something that rewrites a workspace interrupts its sync: an import
   landing, replacing the cloud copy, unlinking, deleting. The interrupted round
   drops its request and its lane goes again afterwards. What it had not
   committed is still queued.
4. A sync that could not reach the relay is tried again by itself, from 5 seconds
   and later each time up to 5 minutes, for as long as the workspace has
   something to send; coming back online or to the foreground tries at once. A
   sync the relay refused (a full account, a client it no longer accepts) waits
   until something changes.
5. Every workspace catches up with the relay at the same moments, shown or not:
   when the app starts, when it is shown again, when the connection comes back.
   One that caught up within the last 30 seconds and has nothing new queued is
   left alone.
6. The cloud icon turns while a round runs, whichever workspace it is for.

How a workspace's sync went (its last error, progress, storage used, whether its
key was retired) is recorded for that workspace, under the key it was learned
with, whichever workspace a window shows. The sync indicator and Sync settings
read the open workspace's, so another workspace's trouble is shown once it is
opened. Each account has one sign-in, good for every window and workspace.

So what other devices changed in a workspace is saved into its database without
anyone opening it, and opening it shows that at once. A workspace left by a
switch, or by the app closing, still sends what was written in it, and a sync
that was under way when the window moved on simply finishes. Between those
moments only the workspace a window shows hears of changes as they happen: the
live connection to the relay is one per window, for the account it shows.

A sync and any number of windows write to the same database at the same time, so
every save merges with what is stored at that moment and none goes over another:
the database only moves forward. An edited note is saved merged with the stored
copy (`saveNote` in `src/lib/db/idb.ts`), and so is a note a sync pulled; a label
keeps the later of two renames; deletes, boards and the canvas library go on top
of the ones stored. Each save reads the stored copy and writes the result, with
its attachment bytes and its upload marks, in one transaction, so no other
window's save can land in between. Whichever of two saves lands last, the result
is the same. An
edit never undoes what a sync brought, and a sync never undoes an edit. A window
that shows a workspace takes in what something else saved one way, writing
nothing: after a sync that ran in it, what that sync saved is merged into what
it holds; after a sync in another window, what the database holds is. A rewrite
in another window takes things away as well, so after one the workspace is
loaded again.

Two things do not merge, and each lands whole in one transaction as a rewrite of
the workspace (`rewriteWorkspace`): an import, and replacing the cloud copy.

Pairing needs no operation of its own. A key received from another device gets a
workspace, and that workspace syncs like any other before a window opens it.
Nothing was written in it on this device, so the account's copy is all it ends up
with, in its database by the time it is shown.

Replacing the cloud copy ("force push") has the shape an import has. The relay's
copy is read first, with nothing held and nothing recorded on this device
(`relaySync.read`). Then one transaction stamps this device's copy past the one that
was read, records the sync state of that copy, and queues every record; an
ordinary sync sends whatever differs. It lands over what it read, so it refuses to
land when anything was saved in the workspace since, and is planned again. A tab
closed at any point leaves the workspace either as it was or ready to upload.

What changes the workspaces themselves (switching, creating, unlinking, deleting,
an import landing) runs one at a time under a separate lock that only ever covers
work on this device. Whatever asks the relay first, registering a key or deleting
the cloud copy, does so before that lock is taken.

A relay that goes silent is not waited for either. On a connection that is up in
name only a request neither arrives nor fails, so each relay request a sync makes
is given up after a minute in which no byte moved (`RELAY_SILENCE_MS` in
`src/lib/syncRetry.ts`); a request that is slow but moving is left to finish. That
is the only time limit on a sync request: a photo on a weak signal takes as long
as it takes, since given up at a fixed time it would start again from nothing.

Sync stays in the background by design: working in a synced workspace should be
as free as working in one that only lives on this device. So a server that could
not be reached is not shown as an error. The notes are saved here and the sync is
tried again by itself; the cloud icon stays calm and Sync settings reads "Saved on
this device · Waiting to sync". The banner above the feed is kept for what needs
the user: a sync the server turned down, a full account, a retired key.

A backup or Google Keep import is read and prepared without holding anything,
then lands in one IndexedDB transaction (`rewriteWorkspace` in
`src/lib/db/idb.ts`): notes, attachments, labels, deletes, boards, the canvas
library and the upload queue are written together or not at all. It lands in the
workspace it was started for, whichever one is open by then, so a tab closed
part-way leaves that workspace exactly as it was.

Notifications are one switch for the whole app (the browser's permission), but
each synced workspace gets a push subscription of its own: a service worker
registration under `/push/<workspace id>/`, with its own push address and a
device id derived per account from a secret that never leaves the device. The
name a window gives the relay so its own changes are not signalled back to it
(`x-sync-client-id`) is a different random one for each account too. The relay
therefore cannot tell from any identifier that two accounts belong to the same
browser; the network address still shows it, and the push provider can tell. Removing or unlinking a workspace removes its
subscription only.

The keyring itself — id, display name, and sync key per workspace — is held in
`localStorage`; see the residual-risk note in
[security.md](security.md#out-of-scope--residual-risk).

## Server

| Area              | Location                                                                   | Responsibility                                            |
| ----------------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| DB layer          | `src/lib/server/db.ts`                                                     | sqld/libSQL clients, withTxn, DDL, meta helpers           |
| Sync store        | `src/lib/server/syncStore.ts`                                              | Relay DB: accounts, envelopes, quotas                     |
| Workers store     | `src/lib/server/cloudflare/`, `cf/accountCoordinator.ts`                   | D1/R2 storage + serialized account sync                   |
| Sync auth         | `src/lib/server/syncAuth.ts`                                               | Ops DB: challenges, sessions, public key auth             |
| Pairing           | `src/lib/server/pairingSessions.ts`                                        | Ops DB: rendezvous for PAKE shares                        |
| Delta API         | `src/routes/api/sync/v2/delta/`                                            | Upload/download encrypted records, slot deletes           |
| History API       | `src/routes/api/sync/history/`                                             | Owner-only encrypted prior note versions                  |
| Register          | `src/routes/api/sync/register/`                                            | Create account credentials                                |
| Reminder wakes    | `src/routes/api/sync/push/*`                                               | Device subscriptions + opaque wake ticks                  |
| Reminder receipts | `src/routes/api/sync/reminders/`, `src/lib/server/reminderHistoryRelay.ts` | Independent encrypted receipt delivery; 10 MB per account |
| Account delete    | `src/routes/api/sync/account/`                                             | Wipe cloud ciphertext for an account                      |
| Rate limits       | `src/lib/server/rateLimit.ts`                                              | Atomic SQL token bucket on ops DB                         |
| Metrics           | `src/lib/server/metrics.ts`, `/metrics`                                    | Operator metrics (admin token)                            |
| Operator status   | `src/lib/server/operatorMonitor.ts`, `/api/admin/status`                   | Anonymous JSON usage + activity                           |
| Wake dispatch     | `src/lib/server/wakeDispatch.ts`                                           | Pull-based wake claiming and push delivery                |
| Wake timer        | `src/lib/server/wakeTimer.ts`, `cf/reminders.ts`                           | Delivers each wake at its time (timer or alarm)           |
| Retention sweep   | `src/lib/server/retentionSweep.ts`                                         | Optional inactive-account sweep (daily gate)              |
| Cron tick         | `src/lib/server/cronTick.ts`                                               | Hourly maintenance: retention + prune                     |
| Cron endpoint     | `src/routes/api/cron/tick/`                                                | Scheduler entry point for cron triggers                   |
| Health            | `/health/live`, `/health/ready`                                            | Liveness and readiness probes                             |
| Hooks             | `src/hooks.server.ts`                                                      | Security headers, request IDs                             |

The delta endpoint uses sync protocol v3 and requires the matching version
header from the app or MCP client; a client on another version is refused and
asks to be updated. Cached clients must reload, and older MCP clients or
self-hosted relays must update. Other API routes are unchanged.
After v3 clients have written records, every deployed app and relay must retain
the endpoint, its version gate, the body-document format and the attachment rule
below. A rollback to earlier code would let old clients misread replacements and
discard edits, and upload notes ahead of the attachments they list. See
[release recovery](development.md#releasing-and-rolling-back).

### Attachments

The relay never lists an attachment version it does not hold. A request commits
whole, so a device uploads an attachment's bytes in the same request as the notes
that list it, and sends every note listing only the versions the relay holds once
that request commits. A note with more new attachments than one request carries
reaches the relay in steps, each one consistent, and the steps count as one
version of the note.

Each device records two facts and decides from them, never from bytes being
absent. Stored bytes carry the version they are (the content hash a note names
its attachment by), and are not read as any other version. From every record it
downloads and uploads, the device records which attachment versions the relay
holds and which attachments the relay's copy of each note lists; an attachment
record no note lists does not count, since any device may delete it. A device
without that record downloads the account once to make it. Every write of
attachment bytes holds a shared Web Lock until it lands, and the device reads
what it holds under that lock alone, so bytes another window is still saving
are never taken for absent.

After a download has drained, each attachment a note lists is settled:

| Held here | On the relay | What happens                                                 |
| --------- | ------------ | ------------------------------------------------------------ |
| yes       | yes          | Nothing.                                                     |
| yes       | no           | This device uploads it with the note.                        |
| no        | —            | The relay is asked for the attachment by name (History API). |

Asked by name, the relay answers with one of three:

- **The version the note lists.** Its bytes are stored.
- **Another version.** The one listed was never uploaded, so the note lists the
  relay's.
- **None.** If the device holds another version of the attachment, the note lists
  that one and the device uploads it. If it holds nothing, the attachment was
  never there and the note stops listing it, with no deletion marker: a device
  that does hold it uploads it and it returns everywhere.

A request that fails stops the sync. A workspace that does not sync has no relay
to ask, so it settles at startup from what the device holds alone: a note lists
the version held, or stops listing an attachment whose bytes were never saved.

### Opaque envelopes

Each synced logical record is uploaded as:

- **slot** — opaque client-chosen identifier for “this logical thing”
- **id** — operation / version identity for idempotent retries
- **ciphertext** — authenticated encrypted blob

The relay can replace or delete by slot without learning whether the payload is
a note, image, label, or board. The storage quota is ciphertext plus estimated
per-record database overhead (default 100 MB).

Each synced record keeps a rolling window of its newest encrypted versions, the
live one included: 14 by default, set with `SCRAPSCACHE_HISTORY_VERSIONS` (1–40).
Saving a new version drops the oldest; one record's saves never evict another's.
A note open in the editor makes one version from open to close: its uploads while
open mark themselves as continuing the version this session uploaded last, and the
relay replaces that version instead of adding one. Only a version the session wrote
itself is continued, so another device's save in between stays in the history, and
a restore uploads what came before it as its own version first.
Older versions count toward the account's storage quota alongside live records,
but never block them: when the two together exceed the quota, the account's
oldest versions give way.
The note editor loads a note's versions in one request, previews a selected
version, and restores it to that note. A device decrypts the version and any
matching attachments in memory; history is never written into IndexedDB.

Deleting a record for good (a note emptied from the trash, an attachment nothing
needs any more) removes it and every version of it from the relay in the same
request; nothing of it is kept. An image removed from a note stays while a
retained version of that note still shows it, so restoring that version brings
it back; it goes on the first sync after the last such version rolls off. Versions outside the window go on the save that pushes them out.
The daily retention sweep only finishes what an interrupted request left, applies
a lowered window, and recounts history usage. Account deletion removes all
history and its ciphertext.

## Deployment shapes

| Mode               | How                             | Notes                                                  |
| ------------------ | ------------------------------- | ------------------------------------------------------ |
| Dev                | `npm run dev`                   | Vite + HMR; sqld required locally                      |
| Workers dev        | `npm run cf:dev`                | Wrangler dev server with workerd runtime               |
| Local prod build   | `npm run build && npm start`    | Node adapter; same env vars as Docker                  |
| Workers prod       | `npm run cf:deploy`             | App, reminders and cron Workers; D1, R2, DOs, a Queue  |
| Compose            | `docker/compose.yaml`           | Pull pinned GHCR image; isolated relay/ops sqld stores |
| PR preview Compose | `docker/compose.dev.yaml`       | Pull GHCR `dev-*` image on port 3000, isolated volumes |
| Tailscale overlay  | `docker/compose.tailscale.yaml` | Sidecar Serve HTTPS on `*.ts.net` (tailnet only)       |

## Related docs

- [security.md](security.md) — security model and crypto choices
- [self-hosting.md](self-hosting.md) — operator runbook
- [development.md](development.md) — contributor workflow

Live note-sync changes reach an open, visible window over `/api/sync/events`,
carrying only the new cursor. Node serves server-sent events from its process.
Workers serve a WebSocket held by the account's `AccountCoordinator` with the
Hibernation API: an idle socket lets the object be evicted and is not billed,
the runtime answers the client's 30-second heartbeat without waking it, and the
object wakes only for uploads, which it serves anyway. This keeps live sync
inside the Workers free plan's daily Durable Object allowance, which an
always-awake stream per open window would use up. The browser picks the
transport at build time (`#lib/syncEventsTransport.js`). The iPhone app reaches
whichever server its setting names, so it asks: it opens the stream, and a 426
sends it to the socket (`src/lib/native/syncEventsTransport.ts`). A window whose
tab is hidden disconnects and catches up when shown again.
