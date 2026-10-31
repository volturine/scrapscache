#!/usr/bin/env bash
# Archive the iPhone app in Release and upload it to App Store Connect, where
# it appears under TestFlight once Apple has processed it.
#
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
# The App Store Connect record (Scraps Cache, com.scrapscache.app) must exist;
# Xcode's automatic signing registers the App ID and provisioning profile.
# No -u: `auth` may stay empty, which bash 3.2 cannot expand safely under it.
set -eo pipefail
cd "$(dirname "$0")/.."

: "${IOS_TEAM_ID:?Set IOS_TEAM_ID to your Apple Developer team ID}"
build_number="${IOS_BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
out="${IOS_OUT_DIR:-/tmp/scraps-ios-release}"

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
	"${auth[@]}" \
	DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
	CURRENT_PROJECT_VERSION="$build_number" \
	archive

sed "s/TEAM_ID/$IOS_TEAM_ID/" ios/App/ExportOptions.plist >"$out/ExportOptions.plist"

xcodebuild \
	-exportArchive \
	-archivePath "$out/App.xcarchive" \
	-exportOptionsPlist "$out/ExportOptions.plist" \
	-exportPath "$out/export" \
	-allowProvisioningUpdates \
	"${auth[@]}"

echo "Uploaded build $build_number; it shows under TestFlight once processed."
