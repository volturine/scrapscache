# Development

Contributor-oriented notes for working on Scraps Cache. Also read
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- Node.js **24** (`.nvmrc`, `package.json` `engines`)
- npm
- Optional: Docker for Compose workflows

## Scripts

| Script                     | Description                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| `npm run dev`              | Vite dev server (SvelteKit)                                      |
| `npm run build`            | Production build (`adapter-node` → `build/`)                     |
| `npm run build:cloudflare` | Workers build (`adapter-cloudflare` → `.svelte-kit/cloudflare/`) |
| `npm run cf:cron:dev`      | Scheduled worker + app service binding with test triggers        |
| `npm start`                | Run the built server (`node build`)                              |
| `npm run preview`          | Vite preview of the production build                             |
| `npm run check`            | `svelte-check` with native TypeScript                            |
| `npm run format`           | Prettier write                                                   |
| `npm run format:check`     | Prettier check (also runs in CI / `validate`)                    |
| `npm test`                 | Run the Vitest suite                                             |
| `npm run test:watch`       | Vitest watch mode                                                |
| `npm run test:e2e`         | Playwright smoke tests against the production build              |
| `npm run validate`         | check + format + test + build + e2e                              |

## Local development

By default the app connects to separate local sqld processes for relay and
operational state. Start them in two terminals:

```sh
docker run --rm -p 8080:8080 ghcr.io/tursodatabase/libsql-server@sha256:6dd3eb276d9d3604e4a48ac4a999a2e267814732d57d7e94c04ba71482333a67
docker run --rm -p 8081:8080 ghcr.io/tursodatabase/libsql-server@sha256:6dd3eb276d9d3604e4a48ac4a999a2e267814732d57d7e94c04ba71482333a67
```

The dev server reads `http://127.0.0.1:8080` and
`http://127.0.0.1:8081` by default (env vars
`SCRAPSCACHE_RELAY_DB_URL` and `SCRAPSCACHE_OPS_DB_URL`).

Tests use `@libsql/client/node` with `file:` URLs (no sqld required). The server
accepts `file:` URLs too, so `SCRAPSCACHE_RELAY_DB_URL=file:relay.db` and
`SCRAPSCACHE_OPS_DB_URL=file:ops.db` run it without sqld.

## Browser smoke tests

`e2e/` holds Playwright tests for the flows a first-time visitor relies on: a
first visit with a clean console, notes offline, checklists, pin, archive, trash,
search, labels, kanban, a due reminder, pairing two browser contexts and syncing
edits and deletes between them, an encrypted backup restored in a fresh browser,
and workspaces. They run against the production build (`npm run build` first), so
`npm run test:e2e` starts `node build` itself on throwaway file-backed databases
with Turnstile off. Install the browser once with `npx playwright install chromium`.
Each test starts from an empty workspace through `openEmptyApp`, and
`createNote` waits for the editor to settle before typing. CI runs the suite in the
`validate` job after the production build.

When developing sync features, use two browser profiles (or a normal window +
a private window) against the same origin and exercise pairing in the Sync UI.

For Cloudflare Workers local development:

```sh
npm run cf:dev
```

The Workers build does not use libSQL or Turso Cloud. Wrangler provides local
D1, R2, and Durable Object persistence. Before the first remote deployment,
create separate production and development resources:

```sh
npx wrangler d1 create scrapscache
npx wrangler d1 create scrapscache-dev
npx wrangler r2 bucket create scrapscache-envelopes
npx wrangler r2 bucket create scrapscache-envelopes-dev
```

Copy the two returned D1 UUIDs into the matching `database_id` entries in
`wrangler.jsonc`. Deployment applies `cf/migrations/` before publishing the app
Worker. `SCRAPSCACHE_SYNC_MAX_ACCOUNT_BYTES`, `SCRAPSCACHE_REMINDER_MAX_ACCOUNT_BYTES`
and `SCRAPSCACHE_HISTORY_VERSIONS` in `wrangler.jsonc` `vars` must match the
self-host defaults (`DEFAULT_MAX_ACCOUNT_BYTES`, `DEFAULT_REMINDER_MAX_ACCOUNT_BYTES`
and `DEFAULT_HISTORY_VERSIONS` in `src/lib/server/operatorConfig.ts` and the Docker
Compose fallbacks).

Cloudflare runs three Workers, deliberately separate:

- **App** (`wrangler.jsonc`): the site, API and push sending.
- **Reminders** (`cf/wrangler.reminders.jsonc`): wake scheduling only. One
  `ReminderScheduler` Durable Object per synced account holds an alarm for that
  account's next reminder. When it fires, it puts the account on the
  `scrapscache-reminder-wakes` queue; the app consumes the queue, sends the
  account's due wakes, and sets the account's next alarm. Bindings run one way
  (app -> schedulers -> queue -> app), so neither Worker needs the other
  deployed first.
- **Maintenance cron** (`cf/wrangler.cron.jsonc`): calls `/api/cron/tick`
  hourly through the private `APP` service binding. It never touches reminders.

Each of those Workers sets `observability.issues.enabled` for production and
`dev`. After the next deploy, Workers Issues groups new exceptions, HTTP 5xx
responses, and error logs in the Cloudflare dashboard. Routing an issue to an
agent, chat, or webhook is a separate automation in that dashboard. Invocation
logs stay off. Nothing may log secrets or note content. An expected
storage-quota response is HTTP 507, so those responses are grouped too.

`npm run cf:dev` runs the app and reminders Workers together; use
`npm run cf:cron:dev` to exercise the Cron Trigger. For local multi-worker
testing, put the app variables in `.dev.vars` and the cron Worker's matching
`SCRAPSCACHE_TICK_SECRET` in `cf/.dev.vars`; both files are ignored by Git.
Configure the secret for the app and cron Workers before deployment.
`npm run cf:deploy` creates the queue if it is missing, then deploys the
reminders Worker, the app and the cron Worker, in that order. The Cloudflare API
token CI uses needs Queues edit permission.

```sh
npx wrangler secret put SCRAPSCACHE_TICK_SECRET
npx wrangler secret put SCRAPSCACHE_TICK_SECRET --config cf/wrangler.cron.jsonc
```

GitHub Actions reads this value from the `SCRAPSCACHE_TICK_SECRET` environment
secret in the matching `development` or `production` GitHub environment and
installs it on both Workers during every deployment.

Account registration is gated by Cloudflare Turnstile, which runs on its own
origin so its script never shares one with the sync keys. `wrangler.jsonc` sets
`PUBLIC_TURNSTILE_ORIGIN` (`https://verify.scrapscache.com` or
`https://verify-dev.scrapscache.com`, both custom domains on the same Worker),
`TURNSTILE_SITEKEY`, and `TURNSTILE_HOSTNAMES`, which is the challenge hostname
because siteverify reports where the widget ran. The widget secret is the
`TURNSTILE_SECRET` environment secret in each GitHub environment, which deployment
installs on the app Worker.

For local testing, `localhost` and `127.0.0.1` are different origins, so one dev
server can play both parts. Open the app at `http://localhost:5173` and put these in
`.env` (or `.dev.vars` for Wrangler):

```sh
SCRAPSCACHE_ORIGIN=http://localhost:5173
PUBLIC_TURNSTILE_ORIGIN=http://127.0.0.1:5173
TURNSTILE_SITEKEY=<a real widget's sitekey>
TURNSTILE_SECRET=<that widget's secret>
TURNSTILE_HOSTNAMES=127.0.0.1
```

Add `127.0.0.1` to that widget's hostnames in the Cloudflare dashboard. Cloudflare's
public test keys are no use for an end-to-end check: their siteverify response
carries no `action` and always names `example.com`, so the server rejects them.

The sole open pull request labeled `deploy-dev` deploys the development Workers
to `dev.scrapscache.com` after validation succeeds. Move the label to switch the
shared development environment to another pull request. Deployment fails if
more than one open pull request has the label. Each development deploy deletes
those Workers (app, reminders and cron) and wipes D1, then recreates them from the pull request, so
Durable Object and D1 migrations from another PR cannot block it. R2 object
bytes are left in place. Deleting the Workers also drops their secrets, so CI
and `npm run cf:deploy:dev` put `SCRAPSCACHE_TICK_SECRET` and `TURNSTILE_SECRET`
back after deploy.
Pushes to `master` deploy the production Workers to `scrapscache.com`. Both use
Worker routes on the existing proxied DNS records, so the records must remain
in place during the cutover. The development deploy ends by running the browser
smoke tests against `dev.scrapscache.com`, so a labeled pull request is a full
release rehearsal: a red run there means the change is not ready for `master`.

## Releasing and rolling back

1. Label the release candidate's pull request `deploy-dev` and wait for the
   development deploy, smoke tests included, to pass.
2. Merge to `master`. The production deploy verifies `/health/ready`; the commit it
   runs is served at `https://scrapscache.com/_app/version.json`.
3. Tag the merge commit `vX.Y.Z` so the container images carry a version tag and
   self-hosters can pin it.
4. Watch `https://scrapscache.com/health/ready`, the Workers Logs and Issues
   panels, and `GET /api/admin/status` for the first hours.
5. To roll back, push a revert of the merge to `master`: the production deploy is
   driven by the branch, so reverting is one more deploy of a known-good commit.
   D1 migrations only add tables and columns, so the previous code keeps working
   on the newer schema; never roll back by editing the database.

### Migrating an existing SQLite relay to Cloudflare

The migration copies only the live `sync.sqlite` state. It does not copy the
backup directory, historical JSON exports, or `raw-originals`. Encrypted sync
envelopes—including attachment records—are streamed to R2; account and routing
metadata are written to D1. The importer also converts the legacy VAPID key
pair so existing reminder push subscriptions remain usable.

Run a staged import while the existing deployment is still serving traffic:

```sh
python3 scripts/migrate_sqlite_to_cloudflare.py stage /absolute/path/to/sync.sqlite
```

Immediately before the production cutover, stop the old application so the
database cannot receive another write. Then rerun the import against the final
snapshot:

```sh
python3 scripts/migrate_sqlite_to_cloudflare.py finalize \
  /absolute/path/to/sync.sqlite --source-stopped
```

`finalize` snapshots SQLite with its WAL, uploads deterministic R2 objects,
replaces the migrated D1 state, verifies every R2 object's length and SHA-256
digest, and removes objects made obsolete by an earlier staged import. Do not
restart the old application after finalization. If it must be restarted during
a rollback, stop it and finalize again before retrying the Workers cutover.

## Testing layout

- Co-located unit tests: `src/lib/**/*.test.ts`, some component tests
- Shared setup: `src/tests/setup.ts` (e.g. fake IndexedDB)
- Operator monitoring: `operatorMonitor.test.ts`, `operatorConfig.test.ts`
- Wake dispatch and retention sweep: `wakeDispatch.test.ts`, `retentionSweep.test.ts`

Prefer tests for:

- Crypto and backup format edge cases
- Sync merge / tombstones / quota
- Rate limiting and request validation
- Image optimization invariants

## CI

GitHub Actions workflow: `.github/workflows/ci-cd.yaml`.

- **validate** job: typecheck + Prettier + Vitest + Node and Cloudflare builds,
  including dry-run validation of both Workers (required PR check)
- **image** job: Docker build; PRs publish `dev-<n>` / `dev-sha-*` only, `master`
  publishes `latest` / `master` / `sha-*`

Dependabot (`.github/dependabot.yml`) updates npm, Docker, and GitHub Actions
weekly.

## Debugging tips

- CSP is strict in production config; if a new asset source is required, update
  `vite.config.ts` deliberately and document why.
- Admin endpoints need `SCRAPSCACHE_ADMIN_TOKEN` once you leave the dev Compose
  default.
- Structured logs on API errors include `requestId` — pass `x-request-id` from
  clients when correlating.

## Documentation

| Doc                                | Use when                             |
| ---------------------------------- | ------------------------------------ |
| [architecture.md](architecture.md) | Understanding modules and data flow  |
| [security.md](security.md)         | Touching crypto, headers, or logging |
| [self-hosting.md](self-hosting.md) | Changing env vars or Compose         |
