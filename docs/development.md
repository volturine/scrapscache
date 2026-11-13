# Development

Contributor-oriented notes for working on Scraps Cache. Also read
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- Node.js **24** (`.nvmrc`, `package.json` `engines`)
- npm
- Optional: Docker for Compose workflows

## Scripts

| Script                     | Description                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`              | Vite dev server (SvelteKit)                                             |
| `npm run dev:admin`        | Operator dashboard, admin API proxied to `npm run dev`                  |
| `npm run build`            | Production build (`adapter-node` → `build/`)                            |
| `npm run build:cloudflare` | Workers build (`adapter-cloudflare` → `.svelte-kit/cloudflare/`)        |
| `npm run build:ios`        | iPhone app bundle (`adapter-static` → `build/ios/`, synced into `ios/`) |
| `npm run ios`              | Open the iPhone app's Xcode project                                     |
| `npm run cf:dev`           | Local Cloudflare stack (reminders Worker + app)                         |
| `npm run cf:cron:dev`      | Scheduled worker + app service binding with test triggers               |
| `npm start`                | Run the built server (`node build`)                                     |
| `npm run preview`          | Vite preview of the production build                                    |
| `npm run check`            | `svelte-check` with native TypeScript                                   |
| `npm run check:watch`      | `svelte-check` in watch mode                                            |
| `npm run format`           | Prettier write                                                          |
| `npm run format:check`     | Prettier check (also runs in CI / `validate`)                           |
| `npm test`                 | Run the Vitest suite                                                    |
| `npm run test:watch`       | Vitest watch mode                                                       |
| `npm run test:e2e`         | Playwright smoke tests against the production build                     |
| `npm run validate`         | check + format + test + build + e2e                                     |

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

Tests use `@libsql/client/node` with `file:` URLs (no sqld required).

## iPhone app

The iPhone app is the same client inside a [Capacitor](https://capacitorjs.com/)
shell (`ios/`, Swift Package Manager, no CocoaPods). It bundles the static build
and talks to whichever server the **Server** row under Settings names (the
app's default server unless changed, see [Two apps](#two-apps)), so one build
serves self-hosters too.
It needs iOS 16.4 or later (`IPHONEOS_DEPLOYMENT_TARGET` in the Xcode project).
That is the oldest iOS that Vite's default build target (`build.target` is
unset in `vite.config.ts`) compiles the web code for, so an older iPhone could
install the app and then fail to run it. When a Vite upgrade raises that
default, raise the deployment target with it.
At its first launch the app asks which server it syncs with: the hosted
service, or a self-hosted relay by https address, which it checks by reading
that server's `/health/ready`; "Decide later" asks again next launch, and the
Server row under Settings answers the question too (`ServerPrompt`,
`serverSetting.chosen`). What differs from the web app lives under
`src/lib/native/` and is loaded only there: the status bar follows the theme (it stays where iOS puts it: on the
folded iPhone Duo the side column is hardware safe area, hidden bar or not), and
reminders are scheduled with the system as local
notifications (the web view has no service worker or web push), which leave
Notification Center once the reminder is answered, here or on another device
(the app hears of the other device's answer when it next syncs). A reminder set
or moved on another device while the app is closed reaches the phone as a push
from the relay through Apple's push service, with the words a browser shows for
a note it does not hold yet (`src/lib/native/remotePush.ts`,
`src/lib/server/apns.ts`): the app registers its push token under each synced
workspace's account and names the wakes it has scheduled itself, and the relay
sends the others. A relay without the app's Apple key answers the registration
with 501 and the app keeps to its own notifications; see
[Self-hosting](self-hosting.md#environment-reference) for the four `SCRAPSCACHE_APNS_*`
settings. A file that
leaves the app (a backup, a workspace's Markdown archive) goes to the share
sheet, since the web view drops a download link (`saveFile`,
`src/lib/native/shareFile.ts`). The drawing editor saves through the
`browser-fs-access` package, so the app's build swaps that package for
`src/lib/native/browserFsAccess.ts` (`capacitorModules` in `vite.config.ts`),
whose save goes to the same share sheet. The shell declares the backup's file type (`Info.plist`,
`com.scrapscache.backup`), without which iOS greys a `.scraps-cache-backup` out
in the picker that Restore opens, and the reason the file plugin reads file
timestamps (`PrivacyInfo.xcprivacy`), which App Store Connect asks of every
upload. On iPhone Duo
the status bar runs down a side column that iOS reserves, folded or open; the
phone tab bar stands in that column as a rail (`PhoneTabBar` with `rail`, from
`sideColumn.svelte.ts`) at every width, so the notes get the cover screen's full
height and the open phone on its side keeps the same navigation in place of the
sidebar, which it does not show. Beside the column the top bar keeps the view
name (folded) and a search field; sync and settings stand in the column as glass
circles above the pill of places, which shows icons alone, in the look iOS gives
its own vertical bars there (`Topbar` portals them with `portalToColumnActions`
into the stack the app layout renders). The stack keeps
clear of what iOS draws in the column: the app's shell
(`ios/App/App/ScrapsBridgeViewController.swift`, the root controller the scene
delegate creates) reads the web view's occlusion regions, which iOS 27.1 reports
for the camera island and the status cluster, and publishes them to the page as
the `ReservedRegions` plugin; `src/lib/native/reservedRegions.ts` turns them into
`--app-rail-top` and `--app-rail-bottom`, since the folded phone turned one way
puts the island at the column's bottom. An iOS before 27.1 says it cannot read
them, and the stylesheet's own values stay. With the keyboard up the stack hides, as the
phone's bar does; there is no room for it under the clock. The palette stays inside
the app frame, so the column keeps its places while it is up: the stack keeps its
own pointer events under the modal's body lock, a place leaves the palette for its
view, and Search toggles it. A dialog that covers the whole screen, as sync does,
covers the column too.

### iPad

The app is universal (`TARGETED_DEVICE_FAMILY = "1,2"`): on an iPad the same
bundle runs in the wide layout a desktop browser gets, in every orientation.
Check a change to the shell or to `src/lib/native/` on an iPad simulator as
well; the share sheet is a popover there, and the keyboard takes half the
screen in landscape.

An iPad also runs the app in a window narrower than the screen, where the page
falls back to the phone's layout as it does in a narrow browser window. Two
things in the shell (`ScrapsBridgeViewController`) are for that window alone:

- it keeps the web view the size of its window. The status bar plugin moves the
  web view down by how much taller the status bar is than the view's top inset,
  which in a window left a black strip above the page;
- it adds the height of the window's controls (the close, minimise and arrange
  buttons iOS draws over the top leading corner) to the safe area, which is all
  the page lays itself out by, so the page starts below them. The height is
  read from the window (its corner-adapted safe area, less its plain one), so
  it is nothing once the window fills the screen, and it is asked for on an
  iPad alone: on an iPhone the same measure is the screen's rounded corners.

Checked (iPad Pro 11-inch and iPhone 18 Pro simulators, iOS 27.2): full screen
in portrait and landscape, with the note editor, the keyboard, the drawing
editor, the share sheet and Files; a window about phone width at the screen's
top edge, in light and dark; window to full screen and back, where the page's
top returns to the same place each time; and an iPhone turned to landscape and
back. Not yet checked: a window moved away from the screen's top edge, the
half and third arrangements, Slide Over, and a window wide enough for the
sidebar.

### Links that open the app

A link to a note and a pairing link are web addresses (`https://<server>/#…`,
see `src/lib/noteLinks.ts` and `createPairingUrl`). iOS opens them in the app
instead of Safari when two things name each other ("universal links"):

- the app's entitlement claims the server's host
  (`com.apple.developer.associated-domains` in `App.entitlements`, from the
  `APP_LINK_HOST` build setting: `scrapscache.com`, or `dev.scrapscache.com` in
  the dev app);
- the server names the app in `/.well-known/apple-app-site-association`
  (`src/lib/server/appLinks.ts`), from `SCRAPSCACHE_IOS_APP_IDS`, which the
  deploy jobs set from the `APPLE_TEAM_ID` secret. The file routes an address
  on any view (a pairing link is made on whichever view the web app shows) as
  long as its fragment has `note=` or `pair=`; every other address stays a web
  page.

The app then gets the link as Capacitor's `appUrlOpen`
(`src/lib/native/appLinks.ts`) and takes its fragment as the page's own, so the
note opens, or the pairing dialog does, exactly as when the link is pasted into
a browser tab. It follows a link only to the server it syncs with
(`serverSetting.origin`). The entitlement is compiled in, so an app pointed at
a self-hosted server is still handed the hosted service's links, which name a
workspace or a pairing its own server knows nothing of: it opens and leaves
them alone, and that server's own links open in the browser.

To try it on a simulator without deploying, serve a build on a host with a real
certificate, set `SCRAPSCACHE_IOS_APP_IDS=<team>.com.scrapscache.app.dev` for
it, and build the app with an xcconfig that includes `Dev.xcconfig` and sets
`APP_LINK_HOST = <host>?mode=developer` and `DEVELOPMENT_TEAM = <team>`. Name
that host as the app's server (Settings › Server); then
`xcrun simctl openurl booted 'https://<host>/#pair=…'` opens the app on the
pairing dialog, and `https://<host>/privacy` opens Safari.

### Export compliance

`Info.plist` sets `ITSAppUsesNonExemptEncryption` to false. Apple's wording for
the key is about documentation, not about whether encryption is used: "Set the
value to NO if your app […] doesn't use encryption, or if it only uses forms
of encryption that are exempt from export compliance documentation
requirements. Otherwise, set it to YES" ("Complying with Encryption Export
Regulations"). The app does ship encryption of its own (the `@noble` libraries
and the pairing exchange), all of it standard, published algorithms. Apple
asks for documentation for that kind only when the app is distributed in
France: a French encryption declaration. So the value holds **while the app is
not available in France**.

France is meant to be supported.
[french-encryption-declaration.md](french-encryption-declaration.md) has the
steps (a declaration to the ANSSI, the ANSSI's document uploaded to Apple, Apple's
code in `Info.plist`) and the technical description the filing needs. Until
they are done, France stays out of the app's availability.

Apple also notes that encryption exempt from documentation can still call for a
year-end self-classification report to the US government, which is the
publisher's own filing. See Apple's "Complying with Encryption Export
Regulations".

### Two apps

The project builds two apps that install side by side, each with its own
storage:

|                | Production                                | Development                                                 |
| -------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Name           | Scraps Cache                              | Scraps Cache Dev                                            |
| Bundle ID      | `com.scrapscache.app`                     | `com.scrapscache.app.dev`                                   |
| Default server | `https://scrapscache.com`                 | `https://dev.scrapscache.com`                               |
| Opens links to | `scrapscache.com`                         | `dev.scrapscache.com`                                       |
| Icon           | `AppIcon`                                 | `AppIcon-Dev` (the same icon with a teal DEV band)          |
| Built from     | `master`, after the production deployment | PRs labelled `deploy-dev`, after the development deployment |

`IOS_VARIANT=dev|prod` picks one; unset means production, so plain Xcode builds
and `npm run ios` are the production app. It acts in two places: `vite.config.ts`
sets the web bundle's default server from it (`DEFAULT_SERVER_ORIGIN`, which the
first-launch prompt, the Server row and its reset use), and the dev app's native
settings live in `ios/App/Dev.xcconfig`, passed to `xcodebuild` with `-xcconfig`.
That file sets `APP_BUNDLE_ID`, `APP_DISPLAY_NAME`, `APP_ICON_NAME` and
`APP_LINK_HOST`, which only the App target reads (into
`PRODUCT_BUNDLE_IDENTIFIER`, `CFBundleDisplayName` in `Info.plist`,
`ASSETCATALOG_COMPILER_APPICON_NAME`, and the associated domain in
`App.entitlements`), so the Swift packages' identifiers stay their own. Both apps share the page origin
`capacitor://localhost`, which is the one the API admits
(`src/lib/server/appCors.ts`).

```sh
npm run build:ios                  # production web bundle → build/ios, then `cap sync ios`
IOS_VARIANT=dev npm run build:ios  # the dev app's web bundle
npm run ios                        # open ios/App/App.xcodeproj in Xcode; run on a simulator
```

From the terminal, with a booted simulator (build the web bundle for the same
variant first; drop the `-xcconfig` line for the production app):

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone Duo' -derivedDataPath /tmp/scraps-ios-dev \
  -xcconfig ios/App/Dev.xcconfig build
xcrun simctl install booted /tmp/scraps-ios-dev/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.scrapscache.app.dev
```

Use a separate `-derivedDataPath` per variant, or the second build reuses the
first one's products.

The first build fetches Capacitor's binary frameworks; if `xcodebuild` sits silent,
it is waiting on a macOS keychain prompt for that download. Running
`swift package --disable-keychain resolve` in `ios/App/CapApp-SPM` first fills the
package cache without the prompt. `ios/App/App/public` and
`ios/App/App/capacitor.config.json` are generated by `cap sync` and not committed.

### TestFlight

`npm run ios:testflight` archives one app in Release and uploads it to App Store
Connect (`scripts/ios-testflight.sh`; export settings in
`ios/App/ExportOptions.plist`); `IOS_VARIANT=dev npm run ios:testflight` does the
dev app. It needs an Apple Developer Program membership, an App Store Connect
record for the app's bundle ID (below), and:

- `IOS_TEAM_ID`: the team ID (Xcode › Settings › Accounts, or the developer
  portal's membership page);
- the signing material from `npm run ios:signing` (below):
  `IOS_DIST_CERT_P12` (the `.p12`, base64), `IOS_DIST_CERT_PASSWORD`, and
  `IOS_PROFILE`, the app's App Store profile (base64);
- either Xcode signed in to the Apple ID of that team, or an App Store Connect
  API key in `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_PATH` (the `.p8` file),
  for the upload.

Signing is manual. The archive is signed with the team's CI Apple Distribution
certificate and the app's App Store profile, so its entitlements (push
notifications) are in the build, and the export signs the same way. For the run
the certificate sits in a keychain of its own and the profile is installed only
until the run ends. Nothing at Apple is created or changed by an upload, and the
API key only uploads, so it needs no more than the App Manager role. Automatic
signing made a development certificate on every CI runner until Apple refused
more, and the cloud signing tried after it needed an Admin key and an unsigned
archive, which leaves the entitlements out.

Each upload takes the UTC minute as its build number unless
`IOS_BUILD_NUMBER` says otherwise; the version is `MARKETING_VERSION` in the
Xcode project. The build appears under TestFlight once Apple has processed it;
internal testers (the team) need no review, external groups do.

CI uploads both apps through the reusable `.github/workflows/testflight.yaml`,
on GitHub's `xcode-27` runner, each in its own concurrency group:

- `testflight-dev` uploads **Scraps Cache Dev** after every development
  deployment (`deploy-cloudflare-dev`, PRs labelled `deploy-dev`), from the same
  commit the dev Workers run;
- `testflight-prod` uploads **Scraps Cache** after every production deployment
  (`deploy-cloudflare-production`, pushes to `master`), so it waits on that
  deployment's approval in the `production` environment.

Both need eight repository secrets: `APPLE_TEAM_ID`, `ASC_KEY_ID`,
`ASC_ISSUER_ID` and `ASC_PRIVATE_KEY` (the whole `.p8` file), made under App
Store Connect › Users and Access › Integrations › App Store Connect API; and
`IOS_DIST_CERT_P12`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROFILE_PROD` and
`IOS_PROFILE_DEV`, which `npm run ios:signing` sets. Without them, or on a
runner whose Xcode 27 lacks the iOS 27.1 SDK the shell needs, the job writes a
notice and steps aside rather than failing the run.

#### Signing material

`npm run ios:signing` (`scripts/ios-signing.mjs`) makes it all, with an API key
that has the Admin role (or access to Certificates, Identifiers & Profiles) in
`ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_PATH`, from a checkout where `gh` can
set the repository's secrets:

1. it checks that `gh` can reach the repository's secrets, and reads the
   repository variable `IOS_DIST_CERT_ID`, the certificate it made last time;
2. it enables the capabilities the entitlements ask for (push notifications,
   associated domains) on
   both App IDs;
3. it makes an Apple Distribution certificate from a key made on the spot and
   writes the `.p12` and its password to a folder of its own; then, app by app,
   it replaces the profile it made before, **Scraps Cache App Store** and
   **Scraps Cache Dev App Store**, and writes the new one there too;
4. it sets the four signing secrets and `IOS_DIST_CERT_ID` from that folder;
5. only then it revokes the certificate named by the old `IOS_DIST_CERT_ID`,
   unless a profile still uses it. It revokes no other certificate and replaces
   no other profile.

If a step fails, it stops with the folder left in place, holding what it made,
and revokes nothing.

Run it again before the certificate expires, a year after it was made, and
after adding a capability to `ios/App/App/App.entitlements` and to the script,
since a new capability invalidates the profiles. `--keep <dir>` makes that
folder `<dir>` and keeps it after a successful run as well, for uploads from a
Mac; otherwise it is temporary and removed once the run succeeds.

#### Setting up an app at Apple

Each bundle ID needs, once:

1. **The App ID**: an explicit App ID for the bundle ID, platform universal,
   in Certificates, Identifiers & Profiles › Identifiers › (+) › App IDs, or
   with the Admin API key (`POST /v1/bundleIds`). The New App form only lists
   explicit IDs, and `npm run ios:signing` needs one to make the profile.
2. **The App Store Connect record**, in App Store Connect › Apps › (+) › New
   App: platform iOS, the app's name, a primary language, the bundle ID from
   step 1, and a unique SKU; requires the Account Holder, Admin or App Manager
   role. The App Store Connect API cannot do this step: `POST /v1/apps` answers
   that apps do not allow `CREATE`.
3. Optionally, a TestFlight internal group for the new app, so the team gets
   its builds.

Until the record exists, the dev app's upload **fails** (the archive succeeds,
the upload is refused) and the script names the bundle ID and points here; it
does not skip, because a missing record is a setup step to finish, not a state
to wait out.

Both App IDs are registered: `com.scrapscache.app` and `com.scrapscache.app.dev`
(the latter on 2026-11-10). The production record is **Scraps Cache** (SKU
`scrapscache-ios`).

### Icons

Every icon is drawn from the SVG masters in `design/app-icon`, named
`<mode>-<shape>-<palette>.svg`, which open in Affinity with named layers. After
editing one, run `npm run icons` (it renders in Playwright's Chromium), which
writes:

- the web icons in `static/` (favicons, the PWA icons, the maskable icon, the
  home-screen icon for Safari) and `og-preview.png`, all from
  `dark-tilted-amber`;
- `AppIcon`: `light-tilted-peach` as the "any" appearance, which iOS before 18
  also shows, `dark-tilted-amber` for dark mode, and `tinted-tilted` for the
  tinted home screen; flattened, since Apple masks the corners itself and
  rejects an alpha channel;
- `AppIcon-Dev`: the light and dark icons under `dev-band.svg`, a teal DEV band;
- one `AppIcon-<master>` set per master, the alternate icons iOS can switch
  to, and an `AppIcon-Dev-<master>` set under the DEV band for the dev app. The
  App target lists them in `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` as
  `$(APP_ICON_NAME)-<master>`, so each app compiles in its own, and the script
  stops if that list and the masters disagree;
- the launch image, the light or dark icon in the middle of a clear square on
  the launch background.

In the iPhone app, Settings > App icon switches between them: a tile
(Automatic, dark or light), tilted or stacked notes, and a colour. Automatic is
the app's primary icon, `AppIcon` (`AppIcon-Dev` in the dev app); the rest set
an alternate through the shell's `AppIcon` plugin
(`ScrapsBridgeViewController.swift`), which takes a master's name and adds the
app's own prefix, so the dev app keeps its DEV band whichever icon is picked.
The choices change the page's preview, and Apply sets the icon, since iOS
confirms each change with an alert of its own. The page draws the masters
themselves, and `src/lib/native/appIcon.test.ts` fails if its choices, the
masters and the alternate icon list fall out of step, so a new master needs a
choice there too.

## Browser smoke tests

`e2e/` holds Playwright tests for the flows a first-time visitor relies on: a
first visit with a clean console, notes offline, checklists, pin, archive, trash,
search, labels, kanban, a due reminder, pairing two browser contexts and syncing
edits and deletes between them, an encrypted backup restored in a fresh browser,
and workspaces. They run against the production build (`npm run build` first), so
`npm run test:e2e` starts `node build` itself, with Turnstile off, against the two
local sqld processes above (or whatever `SCRAPSCACHE_RELAY_DB_URL` and
`SCRAPSCACHE_OPS_DB_URL` point at). The sync test registers an account, which the
relay limits to five per hour, so restart sqld between many runs. Install the
browser once with `npx playwright install chromium`.
Each test starts from an empty workspace through `openEmptyApp`, and
`createNote` waits for the editor to settle before typing. CI runs the suite in the
`validate` job after the production build, with sqld as service containers.

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

Cloudflare runs four Workers, deliberately separate:

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
- **Admin** (`cf/wrangler.admin.jsonc`): `admin.scrapscache.com`. Serves the
  operator dashboard at the host's root (`/admin` redirects there), a separate
  static build of `src/admin` (`npm run build:admin`, run by both builds), and hands `/api/admin/*` and `/metrics` to the app through
  the private `APP` service binding. The app answers those only for the admin
  origin, which nothing but that binding can reach it with.

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
reminders Worker, the app, the admin Worker and the cron Worker, in that order. The Cloudflare API
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

The client learns the challenge origin from its server
(`GET /api/sync/register`, `#lib/turnstileOrigin`), because the iPhone app syncs
with whichever server its setting names. The challenge page posts its token to
the parent the frame names, the web app's origin or the iPhone app's
`capacitor://localhost`, and only those may frame it. The app's bundled CSP has
no request time, so its `frame-src` lists the two hosted challenge origins, read
from `wrangler.jsonc` at build time; a self-hosted server with its own check is
reported in the app instead of framed.

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
puts `SCRAPSCACHE_TICK_SECRET`, `TURNSTILE_SECRET` and `SCRAPSCACHE_ADMIN_TOKEN`
back after deploy (`npm run cf:deploy:dev` restores the first two).
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
5. To recover, push a targeted revert or correction to `master`: production is
   driven by the branch. After sync protocol v2 has accepted writes, retain the
   v2 delta endpoint, its version gate, and the v2 body-document reader/writer in
   both the app and MCP server. Do not deploy a pre-v2 image or revert the full v2
   change: that reopens the old endpoint, whose clients can misread replacements
   and discard edits. Revert unrelated changes independently or fix forward.
   D1 migrations only add tables and columns; never roll back by editing the
   database. The relay holds opaque ciphertext and cannot convert body documents
   for an older client.

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
  including dry-run validation of all four Worker configs (app, reminders, cron
  and the MCP recipe) in both prod and dev variants (required PR check)
- **deploy-cloudflare-dev** / **deploy-cloudflare-production** jobs: the
  development Workers for the PR labelled `deploy-dev`, production for `master`
- **testflight-dev** / **testflight-prod** jobs: the dev and production iPhone
  apps to TestFlight after those deployments (see [TestFlight](#testflight))
- **image** job: Docker build; PRs publish `dev-<n>` / `dev-sha-*` only, `master`
  publishes `latest` / `master` / `sha-*`
- **image-mcp** job: MCP recipe image (`ghcr.io/…-mcp`); same tag scheme

Code scanning: `.github/workflows/codeql.yaml` runs CodeQL for Actions,
JavaScript/TypeScript and Python on pull requests, on `master` and weekly. It
replaces GitHub's default setup, which analysed every language it detected on
`master`, including the Swift of the iPhone shell in `ios/`, whose package
points at `node_modules` that setup never installs; keep default setup off so
the two do not collide.

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

| Doc                                                                  | Use when                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| [architecture.md](architecture.md)                                   | Understanding modules and data flow                       |
| [security.md](security.md)                                           | Touching crypto, headers, or logging                      |
| [self-hosting.md](self-hosting.md)                                   | Changing env vars or Compose                              |
| [french-encryption-declaration.md](french-encryption-declaration.md) | Releasing the app in France, or changing its cryptography |
