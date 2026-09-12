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
- Envelopes written before slot binding still open, so an upgrade does not
  strand what the relay already holds. Nothing writes that form any more, and a
  client that reads one queues the record for rewrite, so an account migrates
  itself as it syncs and the old read path can eventually be deleted

### Account authentication

- The sync key deterministically derives an Ed25519 signing key with domain separation
- The existing sync-key-derived `accountId` remains stable across the authentication upgrade
- The relay stores only the signing public key after new registration or one-time migration
- Clients sign a one-time, 60-second challenge to obtain a bearer session
- Sessions are stored as token hashes in the ops database and expire after 30 minutes
- The signing private key and reusable authentication material never leave the client
- Existing accounts present their legacy secret once over HTTPS to atomically replace its scrypt hash
  with a verified public key; the legacy credential cannot be used again

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

Only current version 4 backup payloads are accepted; new exports are encrypted only.

### Images

Before store/sync, images are re-encoded in the browser to strip EXIF/GPS,
optionally resize, and prefer WebP. Original camera files are not retained as
the long-term attachment format.

## Server hardening

- **CSP** (nonce mode) in `svelte.config.js`: default `self`, no third-party
  scripts/frames; `data:`/`blob:` only where attachments need them
  (`img-src`, `media-src`, and PDF `frame-src`/`object-src`)
- **Headers** in `hooks.server.ts`: `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, restrictive
  `Permissions-Policy`
- **Rate limiting** — atomic SQL token buckets for register, auth, pairing, sync,
  push, and admin. Durable and shared across isolates, at the cost of one database
  write per request — size the store accordingly and put edge rate limiting in
  front of it on a usage-billed platform
- **Admin token** — required for `/metrics`, `GET /api/admin/status`, and
  `POST /api/admin/retention` in production Compose
- **Metrics** — process counters on Node, where one process sees every request.
  On Workers, where no isolate does, the build swaps in a module that emits to an
  Analytics Engine dataset, and the endpoints report `activity: null` rather than
  one isolate's partial count. Route labels are bucketed before emission, so
  nothing account-scoped reaches telemetry
- **Operator status** — `/metrics` and `GET /api/admin/status` are anonymous
  aggregates. The account administration endpoints are not: they list account IDs
  alongside storage, activity and per-account limits, because an operator cannot
  raise one account's quota without naming it. Those IDs are opaque handles
  already stored in the relay database and readable there, so the admin API
  surfaces them rather than revealing anything new. Note content, ciphertext and
  credentials stay unreachable through all of it
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

### Out of scope / residual risk

- Malware on the client device or a malicious browser extension
- XSS in the app itself (defense-in-depth CSP; still treat as critical)
- Traffic analysis (when you sync, envelope sizes, approximate activity)
- Reminder **wake times** if Web Push is used. The relay stores `fireAt` plus a
  domain-separated hash of the random note ID and timestamp so it can dedupe
  delivery independently per device; it never receives note IDs or text.
- **Delivery of the client bundle.** Scraps Cache is a web app, so the end-to-end
  guarantee is re-established from whatever JavaScript the host serves on each
  load. Whoever can deploy — the hosting platform, the Cloudflare or GitHub
  account, or a build-time dependency — can serve a build that exfiltrates the
  sync key from `localStorage`. Build and delivery integrity, not relay opacity,
  is the primary control for a hosted deployment.
- **A lost device keeps what it already has.** "I lost a device" moves the
  workspace to a new sync key and deletes the old account, so the lost device can
  no longer sync or read anything new. Nothing can reach the plaintext already in
  that device's own storage.
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
4. Configure trusted proxy headers only when appropriate
   (`SCRAPSCACHE_ADDRESS_HEADER` / `SCRAPSCACHE_XFF_DEPTH`).
5. Set **`SCRAPSCACHE_TICK_SECRET`**; without it the scheduler endpoint is disabled
   and reminders, pruning, and retention never run.
6. Pin **VAPID keys** in the environment rather than letting them be generated into
   the database, so push survives a rebuilt data store.
7. On a usage-billed platform, configure **spend alerts and edge rate limiting**
   before opening registration to the internet.

## Related source

| Topic                    | Files                                          |
| ------------------------ | ---------------------------------------------- |
| Pairing + payload crypto | `src/lib/syncPairing.ts`                       |
| Backup crypto            | `src/lib/backupCrypto.ts`                      |
| Relay storage            | `src/lib/server/syncStore.ts`                  |
| Reminder wakes           | `src/lib/server/wakeDispatch.ts`, `webPush.ts` |
| Rate limits              | `src/lib/server/rateLimit.ts`                  |
| Admin auth               | `src/lib/server/adminAuth.ts`                  |
| Operator status          | `src/lib/server/operatorMonitor.ts`            |
| Account retention        | `src/lib/server/retentionSweep.ts`             |
| CSP                      | `svelte.config.js`                             |
| Security headers         | `src/hooks.server.ts`                          |
