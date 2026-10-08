# Launch checklist

The public launch of [scrapscache.com](https://scrapscache.com) is the first time
people arrive from advertising instead of from the repository. This page names the
flows that must not break for them and the launch-specific risks that normal
development does not exercise. Each box is ticked by a person or a CI run; nothing
here is assumed.

## Core flows

A new visitor must be able to do each of these on a cold browser, with no account and
no prior data. These are the flows the browser smoke suite covers once it exists;
until then they are a manual pass on the release candidate.

- [ ] **First visit** — the landing page renders with no console errors, the CSP
      blocks nothing the app needs, and the Turnstile challenge on
      `verify.scrapscache.com` loads and passes.
- [ ] **Notes offline** — create, edit, color, pin, archive, trash and restore a note
      with the network disabled after the first load. Data survives a reload.
- [ ] **Checklists and markdown** — `[ ]` / `[x]` lines toggle, headings and tables
      render, find and replace and multi-cursor work in the body.
- [ ] **Labels and search** — attach a label, filter by it, and find a note by text.
- [ ] **Attachments** — add a photo, see the optimized copy, open it, delete it.
- [ ] **Kanban** — create a board, move a card between columns, change a backlog
      filter.
- [ ] **Reminders** — set a reminder, receive the alert on the device that set it,
      dismiss it, and confirm a paired device does not show it again.
- [ ] **Pair and sync** — register, pair a second browser profile with the short
      code, edit on both sides, and see both converge. Delete on one side and watch
      the tombstone land on the other.
- [ ] **Workspaces** — create a second workspace, switch it between private and
      synced, and confirm notes never cross the boundary.
- [ ] **Backup and restore** — export a passphrase-protected backup, wipe the
      browser profile, import it, and get every note and attachment back.
- [ ] **Install as PWA** — the install prompt appears, the installed shell opens
      offline, and the service worker picks up a new build without a stale shell.
- [ ] **Keep import** — import a Google Keep export and see the notes, labels and
      checklists land.

## Launch risks

These are the things a traffic spike or an ad click exposes that a developer's own
usage never does.

### Capacity and cost

- [ ] **Relay quotas** — the free Cloudflare quotas for D1 reads and writes, R2
      operations, Durable Object requests and Queue messages are known, and the
      expected first-week load fits with margin. Write the numbers down here.
- [ ] **Rate limits** — the per-caller token buckets in `src/lib/server/rateLimit.ts`
      (register, auth, pairing, sync, push, admin) are sized so one busy person is
      never throttled and one abuser cannot drain D1 writes. Every check costs one
      D1 write, so edge rate limiting on the zone sits in front of them.
- [ ] **Spend alerts** — a Cloudflare billing alert is set below the amount anyone
      is willing to lose to a bot.
- [ ] **Account retention** — `SCRAPSCACHE_RETENTION_INACTIVE_DAYS` is set and the
      daily sweep runs, so abandoned trial accounts do not accumulate forever.

### Advertising surface

- [ ] **Links** — every ad destination resolves to the canonical origin with no
      redirect chain, and campaign parameters in the URL are dropped by the app
      rather than stored or forwarded.
- [ ] **Previews** — `og-preview.png`, the title and the description in
      `src/app.html` match what the ad promises.
- [ ] **Indexing** — `SCRAPSCACHE_ALLOW_INDEXING` is `true` only on production;
      `robots.txt` and `sitemap.xml` list the canonical origin and nothing from dev.
- [ ] **Legal pages** — `/privacy` and `/terms` are current and linked from the
      landing page, and the privacy page says what the relay stores and for how long.

### Trust

- [ ] **Security headers** — the CSP, `Referrer-Policy`, `X-Frame-Options` and
      `Permissions-Policy` on production match `docs/security.md`, checked with a
      fresh `curl -I`.
- [ ] **Secrets** — `SCRAPSCACHE_ADMIN_TOKEN`, `SCRAPSCACHE_TICK_SECRET`,
      `TURNSTILE_SECRET` and the VAPID pair are pinned in the production
      environment, not generated into the database.
- [ ] **Observability** — Workers Logs and Issues are on for the app, reminders and
      cron Workers; invocation logs stay off.
- [ ] **Error page** — `+error.svelte` renders something a visitor can act on when
      the relay is unreachable, and the app still opens offline in that case.

### Release mechanics

- [ ] **Release candidate** — the candidate is a tagged commit on `master`,
      deployed to `dev.scrapscache.com` with the `deploy-dev` label and walked
      through every core flow there first.
- [ ] **Rollback** — the previous production commit sha is written down before the
      deploy; rolling back is a push of that sha to `master`, and the D1
      migrations in the candidate are known to be backward compatible with it.
- [ ] **Health** — `https://scrapscache.com/health/ready` is watched for the first
      hours after the deploy, alongside the Workers error rate.
- [ ] **Self-host image** — the `latest` and version tags on GHCR point at the
      launched commit, so people who read the README get the same build.

## Out of scope for launch

Things deliberately not promised in the first public release, so that a missing one
is not a bug report: multi-user shared notes, server-side search, account recovery
without a backup or a paired device.
