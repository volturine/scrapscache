# Security and privacy

This document describes Scraps Cache's security model for operators and contributors.
For how to report vulnerabilities, see [SECURITY.md](../SECURITY.md).

## Goals

- Keep **note content private** from the sync server and from passive network
  observers when TLS is used.
- Make **multi-device sync** possible without uploading plaintext.
- Provide **user-controlled encrypted backups** independent of the relay.
- Avoid accidental leaks via **logs, metrics, CSP, and link previews**.

## Trust boundaries

| Component                      | You trust it with                                                         | You should not trust it with                          |
| ------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Your browser / device          | Local note plaintext, sync key, backup passphrase while entered           | Malware, hostile extensions, shared unlocked sessions |
| Self-hosted relay              | Ciphertext, auth material hashes, metadata (sizes, timing, IPs if logged) | Note plaintext, sync key, backup passphrase           |
| Reverse proxy / TLS terminator | TLS keys, request metadata                                                | Application secrets if misconfigured                  |
| Client backup file             | Ciphertext at rest                                                        | Passphrase (never stored in the file)                 |
| Hosting platform (Cloudflare)  | Ciphertext, metadata, TLS termination, **delivery of the client bundle**  | Nothing more than you trust the app itself with       |

## Cryptography overview

### Sync payloads

- Algorithm: **XChaCha20-Poly1305** (`@noble/ciphers`)
- Key: derived from the client-held sync key
  (`scraps-cache-sync-payload:v1:…` domain separation via SHA-256)
- Nonce: random 24 bytes per envelope
- AAD: binds the account id and the slot, so the cipher itself rejects an
  envelope a relay moved between slots or accounts
- Server stores only a version byte, the nonce, and the ciphertext
- Per-record sync history keeps the newest encrypted envelopes on the relay (14 by
  default); only a device with the sync key can read note content. A device opens
  a version with the slot it asked for, so the relay cannot pass one record's
  envelope off as another's. History responses use `Cache-Control: no-store` and
  are not saved in device storage. Deleting a record removes it and all its
  versions from the relay at once, and versions outside the window go as they
  roll off. An upload may say it continues the version it replaces (one editing
  session); the relay then drops that version, which can only be the live one the
  upload's conditional write replaces. Devices set this only for a version their
  own open editing session uploaded
- Every envelope carries a version byte and is bound to its account and slot as
  AEAD associated data. Clients (the app, history, reminder receipts and the MCP
  recipe) open only that form; an envelope without the binding, or one the relay
  moved from another slot, fails to authenticate and is skipped as unreadable

### Account authentication

- The sync key deterministically derives an Ed25519 signing key with domain separation
- The relay stores only the signing public key, set when the account registers
- Clients sign a one-time, 60-second challenge to obtain a bearer session
- Sessions are stored as token hashes in the ops database and expire after 30 minutes
- The signing private key and reusable authentication material never leave the client
- Deleting cloud data retires the sync key: the relay keeps the deleted `accountId`
  and refuses to register it again. A device still holding the key, such as a lost
  one, cannot recreate the account and read what another device would upload
  there; devices that sync with it are told the key is gone and offered a new one.
  Accounts removed by the retention sweep are not retired, so recovery can
  recreate them

### Device pairing

- The existing device shows a **one-time 16-character pairing code** (80 bits,
  60-second lifetime). It is not derived from the sync key and is not reused.
- Devices run **CPace** (ristretto255) over that code so they share a session key
  without revealing the code or sync key to the relay.
- The sync key is sealed to the peer with XChaCha20-Poly1305 under the PAKE
  output; the server only relays opaque PAKE shares and ciphertext. The rendezvous
  tag is a hash of the high-entropy one-time code, not a crackable 14-digit secret.

### Client backups (`.scraps-cache-backup`)

- Format name: `scraps-cache-encrypted-backup`
- KDF: **Argon2id** (parameters stored in the header so they can evolve)
- Bulk encryption: **XChaCha20-Poly1305** in authenticated chunks
- AAD binds format version, KDF params, chunk index, and count
- Passphrase is confirmed on export and **never persisted** by the app

Version 5 backup payloads are exported and accepted, and version 4 payloads still import
(without a canvas library or reminder history). New exports are encrypted only. A
backup carries the workspace's canvas library and reminder history along with its notes.

### Images

Before store/sync, images are re-encoded in the browser to strip EXIF/GPS,
optionally resize, and prefer WebP. Original camera files are not retained as
the long-term attachment format.

## Server hardening

- **Build version** — every build is stamped with the commit it came from, served
  at `/_app/version.json`, so a deployment names the code it runs
- **CSP** (nonce mode) in `vite.config.ts`: default `self`, no third-party
  scripts; `data:`/`blob:` only where attachments need them
  (`img-src`, `media-src`, and PDF `frame-src`/`object-src`). The only third-party
  frame allowed is the configured Turnstile challenge origin
- **Turnstile isolation** — Turnstile's script runs only on a separate challenge
  origin, which the app frames and which can pass back nothing but a token.
  Nothing third-party ever runs on the origin that holds the sync keys, so the
  deployment verification below covers all code that can reach them
- **Headers** in `hooks.server.ts`, on both Node and Workers:
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, restrictive `Permissions-Policy`,
  `Cross-Origin-Resource-Policy: same-origin`, and `Cache-Control: no-transform`
  on HTML so a CDN cannot inject scripts into the key-bearing origin.
  `Cross-Origin-Opener-Policy: same-origin` keeps other sites' windows from
  holding a reference to an app window. The one exception is `/mcp/authorize`,
  which an MCP client's OAuth flow may run inside a popup it opened and watches;
  it keeps the opener so that flow can finish. Nothing else needs a cross-origin
  window: the Turnstile challenge is a framed page (opener policy does not apply
  to frames) that answers with `postMessage`, and push runs in the service
  worker. Static files (the bundle, icons, the link-preview image) are served
  before the hook, so they carry none of these and stay embeddable
- **Rate limiting** — atomic SQL token buckets for register, auth, pairing, sync,
  push, and admin, keyed by client address with IPv6 clients bucketed by their
  /64, plus one shared bucket for registrations. The expensive authenticated
  endpoints also have account buckets: sync rounds per minute, sync writes
  (charged one token per upload or delete: a 10,000-write burst for a first
  upload, then 2,000 a day; charged only once a round can run, and refunded when
  the round does not apply its writes, so busy, failed and conflicting rounds
  cost nothing. A first upload of more than 10,000 records continues at 2,000 a
  day; there is no per-account override), and reminder wake publishes (30 per five minutes). Durable and shared
  across isolates, at the cost of one database write per check, refusals included —
  size the store accordingly and put edge rate limiting in front of it on a
  usage-billed platform (see [Request cost on Workers](#request-cost-on-workers))
- **Web Push** — a push endpoint is accepted only on the browsers' own push
  services (Mozilla, FCM, Apple, WNS), checked again at send time; sends never
  follow redirects, and one dispatch round wakes at most an account's device
  allowance, so the relay cannot be pointed at other hosts or used to flood one
- **Admin token or Cloudflare Access** — `/metrics` and every `/api/admin/*`
  endpoint need the admin token or a request Cloudflare Access signed for the
  configured application; the Access JWT's signature, issuer and audience are
  checked against the team's keys, never the header's presence. Every endpoint
  charges the per-address admin bucket before either check, so the token cannot
  be guessed at request speed. On Workers the dashboard is its own Worker on
  `admin.scrapscache.com`, a static build with no access to the notes app's
  origin or code, and it reaches the admin API only through a service binding to
  the app; the app answers that API only for the admin origin, so its public
  origin answers none of it
- **Metrics** — process counters on Node, where one process sees every request.
  Counter keys name an event or a bucketed route, never an account. On Workers,
  where no isolate does, the app counts nothing and the endpoints report
  `activity: null`: Cloudflare's Worker analytics count requests, status codes
  and durations, Workers Logs keep failures, and D1 query insights report
  statement costs, none of which costs the Worker a write. Refused requests are
  not logged either, so a flood of them buys no log volume; the dashboard reads
  throttled callers from the rate-limit buckets
- **Operator status** — `/metrics` and `GET /api/admin/status` are anonymous
  aggregates. The account administration endpoints are not: they list account IDs
  alongside storage, activity and per-account limits, because an operator cannot
  raise one account's quota without naming it. Those IDs are opaque handles
  already stored in the relay database and readable there, so the admin API
  surfaces them rather than revealing anything new. Note content, ciphertext and
  credentials stay unreachable through all of it
- **Runtime settings** — non-secret policy overrides are stored under namespaced
  keys in the operational database. The API accepts only the known settings and
  validates every value before atomically applying a patch. Deployment secrets
  and infrastructure bindings cannot be changed through the app
- **Account retention** — optional; a daily sweep deletes unused relay accounts
  after `SCRAPSCACHE_RETENTION_INACTIVE_DAYS` with no authenticated activity.
  Disabled by default. Sweep logs report counts only
- **No remote link previews** — URL cards are local hostname badges only;
  opening a link is an explicit user action
- **Docker** — unprivileged-oriented Compose, read-only root filesystem,
  `no-new-privileges`, data on volumes

### Logging rules

Logs and error responses must not contain:

- Note content or labels
- Ciphertext or encryption keys
- Authentication secrets or pairing codes
- URLs extracted from notes
- Complete account identifiers when avoidable

Structured logs use request IDs; prefer redacted identifiers.

## Threat model notes

### Mitigated (design intent)

- Curious or compromised **relay operator** reading note bodies from the DB
  (the database only — see the hosted-platform note below)
- Passive network attacker seeing note plaintext (with HTTPS)
- Casual metadata scraping via OpenGraph-style server-side previews
- Cross-site embedding / simple clickjacking (frame denial + CSP)
- A **lost device** receiving new notes once its workspace's cloud data is deleted
  and the workspace moves to a new key. What that device already stores stays
  readable to whoever holds it

### Out of scope / residual risk

- Malware on the client device or a malicious browser extension
- XSS in the app itself (defense-in-depth CSP; still treat as critical)
- Traffic analysis (when you sync, envelope sizes, approximate activity)
- Reminder **wake times** if Web Push is used. The relay stores `fireAt` plus a
  domain-separated hash of the random note ID and timestamp so it can dedupe
  delivery independently per device; it never receives note IDs or text. A
  repeating reminder sends each of its times for the next 60 days (at least its
  next two) as separate, unlinked wakes, so the relay can see a regular pattern
  of times, though not that they belong to one note.
- **Delivery of the client bundle.** Scraps Cache is a web app, so the end-to-end
  guarantee is re-established from whatever JavaScript the host serves on each
  load. Whoever can deploy — the hosting platform, the Cloudflare or GitHub
  account, or a build-time dependency — can serve a build that exfiltrates the
  sync key from `localStorage`. Build and delivery integrity, not relay opacity,
  is the primary control for a hosted deployment.
- **Envelope replay by the relay.** Envelopes are bound to their account and slot,
  so a relay cannot move one elsewhere, but it can replay an older envelope into
  the same slot. Devices holding newer state reject that through merge clocks and
  tombstones; a fresh install restoring from the relay has nothing to compare
  against.
- Lost backup passphrase or lost sync key without another device / backup
- Active MITM if TLS is misconfigured or users accept bad certificates
- Physical access to an unlocked browser session with IndexedDB data
- The **sync key keyring is stored in `localStorage`** and is plaintext-readable
  by script running in the app's origin. A device holding several workspaces
  keeps every saved key in that one entry, so the reachable scope is all of
  them, not one. Given XSS or an unlocked session an attacker can equally read
  decrypted notes from memory, so wrapping the keys at rest would not raise the
  practical bar against this threat model; it is accepted residual risk rather
  than an oversight. It does mean a workspace on a device is only as isolated as
  the origin: the separation is organisational, not a security boundary.

Local live notes are **not** wrapped in an extra “vault passphrase” while the
app is in use; browser storage isolation is the boundary.

## Operator checklist

1. Terminate **HTTPS** at a reverse proxy; set `SCRAPSCACHE_ORIGIN` to the public URL.
2. Set a strong random **`SCRAPSCACHE_ADMIN_TOKEN`**.
3. Pin **`SCRAPSCACHE_IMAGE`** to a release tag or digest.
4. Match the client-address header to how traffic arrives
   (`SCRAPSCACHE_ADDRESS_HEADER` / `SCRAPSCACHE_XFF_DEPTH`). Compose trusts
   `X-Forwarded-For` because its port is loopback-only; set the header empty if
   clients reach Node directly.
5. Keep sqld on the internal network. It runs without authentication; Compose
   publishes it only on the host's `127.0.0.1`.
6. Set **`SCRAPSCACHE_TICK_SECRET`**; without it the scheduler endpoint is disabled
   and reminders, pruning, and retention never run.
7. Pin **VAPID keys** in the environment rather than letting them be generated into
   the database, so push survives a rebuilt data store.
8. On a usage-billed platform, configure **spend alerts and edge rate limiting**
   before opening registration to the internet.

## Related source

| Topic                    | Files                                                                  |
| ------------------------ | ---------------------------------------------------------------------- |
| Pairing + payload crypto | `src/lib/syncPairing.ts`                                               |
| Backup crypto            | `src/lib/backupCrypto.ts`                                              |
| Relay storage            | `src/lib/server/syncStore.ts`                                          |
| Reminder wakes           | `src/lib/server/wakeDispatch.ts`, `webPush.ts`                         |
| Rate limits              | `src/lib/server/rateLimit.ts`                                          |
| Admin auth               | `src/lib/server/adminAuth.ts`, `cloudflareAccess.ts`, `adminOrigin.ts` |
| Operator status          | `src/lib/server/operatorMonitor.ts`                                    |
| Account retention        | `src/lib/server/retentionSweep.ts`                                     |
| CSP                      | `vite.config.ts`                                                       |
| Security headers         | `src/hooks.server.ts`                                                  |

### Independent reminder receipts

Reminder history uses authenticated `/api/sync/reminders` requests, separate from
note delta sync. The relay stores one encrypted row per note, bound to a keyed
hash of the note id, plus a deletion flag. It can tell when a note's receipts
change, and so roughly how often that note's reminders fire or are dismissed,
much as note-sync slots reveal when a record changes. It never sees note ids,
text, reminder times or keys. Receipts have their own per-account bound,
`SCRAPSCACHE_REMINDER_MAX_ACCOUNT_BYTES` (10 MB by default, including row
overhead), apart from the note quota, a 4 KiB ciphertext limit, 12-note pages, and
independent request rate limits. A replacement is written only if it fits, so a
full account keeps what it has; deleting a note always frees its row. An upload
never replaces a row its device has not downloaded. Deletion keeps an opaque
marker to reject later uploads from an offline device. Account deletion cascades
to receipts.
Service workers queue local receipts without access to sync keys; the app encrypts
and uploads them when running. Note sync cursors and outboxes are not involved.

### Live change sockets (Workers)

Browsers cannot set headers on a WebSocket, so the note-sync socket offers the
access token as its second subprotocol: `Sec-WebSocket-Protocol:
scrapscache-sync, <token>`. The token therefore travels in a request header,
as with `Authorization`, and never in the URL or access logs; the relay answers
with `scrapscache-sync` alone, never echoing the token. The token is checked
against the same session table as every sync request. Upgrades whose `Origin`
is not the app's own are refused before authentication, and a malformed client
id is refused outright. The coordinator records the session's expiry with each
socket and closes it (code 4401) once passed, so the client signs in again;
deleting the account closes its sockets. Each account holds at most 16 sockets,
and connection attempts share the events endpoint's rate limit. Sockets carry
only cursors, never ciphertext.

### Live change streams (Node)

Node serves the same signals as server-sent events, authenticated with the
`Authorization` header like any sync request, under the same rules: at most 16
open streams per account (`MAX_SYNC_EVENT_CONNECTIONS`), each ended when its
session expires so the client signs in again, and every stream of an account
ended at once when its sessions are revoked (account deletion). Streams carry
only cursors, never ciphertext.

### Request cost on Workers

D1 bills rows read and written, so the relay avoids writes that change nothing:

- A round that only reads moves an account's `last_seen_at` at most once an
  hour; activity windows and retention count days. A round that writes sets it
  in the accounts update it makes anyway, so that costs no extra row.
- A reminder wake publish writes only the wakes that were added, removed or moved,
  plus the revision that orders publishes. Delivery is re-armed only when the wakes
  changed, or when an earlier change was never handed to the scheduler: that stays
  owed in the database until an arm succeeds.
- A photo kept because an older version of its note still lists it is checked
  again at most hourly, so one that quota eviction has freed is reclaimed then.

Measure what each kind of request costs from Cloudflare's own D1 query insights,
which report rows read and written per statement with no app code:
`npx wrangler d1 insights scrapscache --env '' --time-period 7d --sort-by writes`.
To measure each request type locally against Miniflare's D1:
`MEASURE_D1=1 npx vitest run src/lib/server/cloudflare/d1Cost.measure.test.ts --disable-console-intercept`.

The app's own buckets are defence in depth, and each check is a D1 write. Zone
rate-limiting rules, counted per IP, should refuse floods before they reach the
Worker. Set each at or above the app's own allowance for that path, so ordinary
use never meets the edge rule:

| Path                 | App allowance per address |
| -------------------- | ------------------------- |
| `/api/sync/v2/delta` | 120 a minute              |
| `/api/sync/history`  | 120 a minute              |
| `/api/sync/pair/*`   | 60 a minute               |
| `/api/sync/push/*`   | 40 a minute               |
| `/api/sync/auth/*`   | 30 a minute               |
| `/api/sync/register` | 5 an hour                 |

The production zone runs one such rule, the Free plan's only one, set in the
dashboard (Security → WAF → Rate limiting rules) since the Wrangler login cannot
read WAF rules:

| Setting  | Value                           |
| -------- | ------------------------------- |
| Match    | URI path wildcard `/api/sync/*` |
| Count by | IP                              |
| Limit    | 100 requests per 10 seconds     |
| Action   | Block for 10 seconds            |

It covers every sync path at once, and devices sharing an address share it. A
first sync's back-to-back rounds stay under it, while a flood is cut to about 10
requests a second per address. A refused request gets a `429` from the edge
(error 1015) with `Retry-After`, which the app treats as throttling and waits
out. To check it still holds, request a path under `/api/sync/` that does not
exist 150 times at once: about 100 answer `404` from the app and the rest `429`
from the edge, without touching D1.

Preview URLs bypass zone rules; `wrangler.jsonc` keeps them off.

### Relay memory bounds (Node)

A sync round authenticates, charges the account's rate limit and reads its whole
body before it takes one of the process's sync slots, so a slow upload cannot
hold a slot while its bytes arrive. The bodies themselves are bounded by a
separate set of slots, twice the sync slot count (16 by default, so at most
16 × 17 MB buffered), each held only while one body is read and parsed; a
request past either bound is answered 503 with `Retry-After` before any byte
of it is read. Download pages and history listings read
record sizes first and load only the ciphertexts inside the 24 MB page budget
(always at least one record), the same budget Workers applies.
