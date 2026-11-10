#!/usr/bin/env bash
# Archive the iPhone app in Release and upload it to App Store Connect, where
# it appears under TestFlight once Apple has processed it.
#
#   IOS_VARIANT       prod (default): "Scraps Cache", com.scrapscache.app,
#                     syncing with https://scrapscache.com
#                     dev: "Scraps Cache Dev", com.scrapscache.app.dev,
#                     syncing with https://dev.scrapscache.com
#                     (ios/App/Dev.xcconfig, vite.config.ts)
#   IOS_TEAM_ID       Apple Developer team ID (required)
#   IOS_BUILD_NUMBER  CFBundleVersion; defaults to the UTC minute, so each
#                     upload is newer than the last
#   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH
#                     an App Store Connect API key (.p8) for signing and the
#                     upload; without them Xcode's own account (Settings ›
#                     Accounts) is used
#   IOS_OUT_DIR       where the archive and export land (default
#                     /tmp/scraps-ios-release)
#
# The variant's explicit App ID and its App Store Connect record must exist
# (docs/development.md › TestFlight). Automatic signing creates the profile but
# does not register the App ID: the app has no entitlements, so it signs with
# the team's wildcard profile.
# No -u: `auth` may stay empty, which bash 3.2 cannot expand safely under it.
set -eo pipefail
cd "$(dirname "$0")/.."

: "${IOS_TEAM_ID:?Set IOS_TEAM_ID to your Apple Developer team ID}"
build_number="${IOS_BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
out="${IOS_OUT_DIR:-/tmp/scraps-ios-release}"

export IOS_VARIANT="${IOS_VARIANT:-prod}"
case "$IOS_VARIANT" in
	prod) variant=() ;;
	dev) variant=(-xcconfig ios/App/Dev.xcconfig) ;;
	*)
		echo "IOS_VARIANT must be dev or prod, not $IOS_VARIANT" >&2
		exit 1
		;;
esac

auth=()
if [ -n "${ASC_KEY_ID:-}" ]; then
	: "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID alongside ASC_KEY_ID}"
	: "${ASC_KEY_PATH:?Set ASC_KEY_PATH to the .p8 file of the API key}"
	auth=(
		-authenticationKeyID "$ASC_KEY_ID"
		-authenticationKeyIssuerID "$ASC_ISSUER_ID"
		-authenticationKeyPath "$ASC_KEY_PATH"
	)
fi

rm -rf "$out"
mkdir -p "$out"

npm run build:ios

xcodebuild \
	-project ios/App/App.xcodeproj \
	-scheme App \
	-configuration Release \
	-destination 'generic/platform=iOS' \
	-archivePath "$out/App.xcarchive" \
	-allowProvisioningUpdates \
	"${variant[@]}" \
	"${auth[@]}" \
	DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
	CURRENT_PROJECT_VERSION="$build_number" \
	archive

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleIdentifier' "$out/App.xcarchive/Info.plist")"
echo "Archived $bundle_id build $build_number"

sed "s/TEAM_ID/$IOS_TEAM_ID/" ios/App/ExportOptions.plist >"$out/ExportOptions.plist"

if ! xcodebuild \
	-exportArchive \
	-archivePath "$out/App.xcarchive" \
	-exportOptionsPlist "$out/ExportOptions.plist" \
	-exportPath "$out/export" \
	-allowProvisioningUpdates \
	"${auth[@]}"; then
	hint="The upload of $bundle_id failed. If it is the first one, check that App Store Connect has an app record with this bundle ID (docs/development.md › TestFlight)."
	if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error title=TestFlight upload failed::$hint"; else echo "$hint" >&2; fi
	exit 1
fi

echo "Uploaded $bundle_id build $build_number; it shows under TestFlight once processed."
