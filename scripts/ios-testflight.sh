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
#   IOS_DIST_CERT_P12, IOS_DIST_CERT_PASSWORD
#                     the team's CI Apple Distribution certificate with its
#                     private key, as a base64 .p12, and the .p12's password
#                     (required; scripts/ios-signing.mjs makes them)
#   IOS_PROFILE       the variant's App Store provisioning profile, base64
#                     (required; scripts/ios-signing.mjs makes it)
#   IOS_BUILD_NUMBER  CFBundleVersion; defaults to the UTC minute, so each
#                     upload is newer than the last
#   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH
#                     an App Store Connect API key (.p8) for the upload;
#                     without them Xcode's own account (Settings › Accounts)
#                     is used
#   IOS_OUT_DIR       where the archive and export land (default
#                     /tmp/scraps-ios-release)
#
# Signing is manual and needs nothing from Apple at build time. The archive is
# signed with the distribution certificate and the variant's profile, so the
# entitlements (push) are in it, and the export signs the same way. Automatic
# signing made a development certificate on every CI runner until Apple refused
# more; cloud signing needed an Admin API key and an unsigned archive, which
# drops entitlements. The certificate goes into a keychain of its own for the
# run, and the profile is installed only for it.
#
# No -u: `auth` may stay empty, which bash 3.2 cannot expand safely under it.
set -eo pipefail
cd "$(dirname "$0")/.."

: "${IOS_TEAM_ID:?Set IOS_TEAM_ID to your Apple Developer team ID}"
: "${IOS_DIST_CERT_P12:?Set IOS_DIST_CERT_P12 to the distribution certificate (.p12, base64); see scripts/ios-signing.mjs}"
: "${IOS_DIST_CERT_PASSWORD:?Set IOS_DIST_CERT_PASSWORD to the .p12 password}"
: "${IOS_PROFILE:?Set IOS_PROFILE to the App Store provisioning profile of IOS_VARIANT (base64)}"
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

# The signing identity and profile, for this run only.
umask 077
signing="$(mktemp -d)"
keychain="$signing/signing.keychain-db"
keychain_password="$(openssl rand -hex 24)"
profiles_dir="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
searched="$(security list-keychains -d user | sed 's/^ *"//; s/"$//')"
profile_file=""
cleanup() {
	# shellcheck disable=SC2086 # one keychain path per line, none with spaces
	[ -n "$searched" ] && security list-keychains -d user -s $searched
	security delete-keychain "$keychain" 2>/dev/null || true
	[ -n "$profile_file" ] && rm -f "$profile_file"
	rm -rf "$signing"
}
trap cleanup EXIT

printf '%s' "$IOS_DIST_CERT_P12" | base64 --decode >"$signing/certificate.p12"
printf '%s' "$IOS_PROFILE" | base64 --decode >"$signing/profile.mobileprovision"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$signing/certificate.p12" -k "$keychain" -P "$IOS_DIST_CERT_PASSWORD" \
	-T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple: -k "$keychain_password" "$keychain" >/dev/null
# shellcheck disable=SC2086
security list-keychains -d user -s "$keychain" $searched

security cms -D -i "$signing/profile.mobileprovision" >"$signing/profile.plist"
profile_name="$(/usr/libexec/PlistBuddy -c 'Print :Name' "$signing/profile.plist")"
profile_uuid="$(/usr/libexec/PlistBuddy -c 'Print :UUID' "$signing/profile.plist")"
mkdir -p "$profiles_dir"
# One already installed stays where it is, after the run as well.
if [ ! -e "$profiles_dir/$profile_uuid.mobileprovision" ]; then
	profile_file="$profiles_dir/$profile_uuid.mobileprovision"
	cp "$signing/profile.mobileprovision" "$profile_file"
fi
umask 022

npm run build:ios

# APP_PROVISIONING_PROFILE reaches the App target alone; a profile set for the
# whole build would also land on the Capacitor frameworks, which take none.
xcodebuild \
	-project ios/App/App.xcodeproj \
	-scheme App \
	-configuration Release \
	-destination 'generic/platform=iOS' \
	-archivePath "$out/App.xcarchive" \
	"${variant[@]}" \
	DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
	CURRENT_PROJECT_VERSION="$build_number" \
	CODE_SIGN_STYLE=Manual \
	CODE_SIGN_IDENTITY="Apple Distribution" \
	APP_PROVISIONING_PROFILE="$profile_name" \
	OTHER_CODE_SIGN_FLAGS="--keychain $keychain" \
	archive

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleIdentifier' "$out/App.xcarchive/Info.plist")"
echo "Archived $bundle_id build $build_number, signed with the profile \"$profile_name\""

sed -e "s/TEAM_ID/$IOS_TEAM_ID/" -e "s/BUNDLE_ID/$bundle_id/" -e "s/PROFILE_NAME/$profile_name/" \
	ios/App/ExportOptions.plist >"$out/ExportOptions.plist"

if ! xcodebuild \
	-exportArchive \
	-archivePath "$out/App.xcarchive" \
	-exportOptionsPlist "$out/ExportOptions.plist" \
	-exportPath "$out/export" \
	"${auth[@]}"; then
	hint="The upload of $bundle_id failed. If it is the first one, check that App Store Connect has an app record with this bundle ID (docs/development.md › TestFlight)."
	if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error title=TestFlight upload failed::$hint"; else echo "$hint" >&2; fi
	exit 1
fi

echo "Uploaded $bundle_id build $build_number; it shows under TestFlight once processed."
