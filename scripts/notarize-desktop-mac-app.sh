#!/bin/sh
set -eu

# 向 Apple 提交已签名应用，等待公证完成并把 ticket staple 到应用。

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
DESKTOP_DIR="$ROOT_DIR/app/desktop"
PACKAGE_JSON="$DESKTOP_DIR/package.json"
APP_PATH="${DOWNCITY_RELEASE_APP_PATH:-$DESKTOP_DIR/dist/mac-arm64/Downcity.app}"
NOTARY_PROFILE="${DOWNCITY_NOTARY_PROFILE:-${APPLE_KEYCHAIN_PROFILE:-VIBEMEET_NOTARY_PROFILE}}"

. "$SCRIPT_DIR/desktop-release-version.sh"

app_version=$(read_package_version "$PACKAGE_JSON")
if [ -z "$app_version" ]; then
  echo "Unable to read Desktop version from app/desktop/package.json." >&2
  exit 1
fi
if [ ! -d "$APP_PATH" ]; then
  echo "Missing signed app: $APP_PATH" >&2
  echo "Run pnpm desktop:build:mac first." >&2
  exit 1
fi
if [ -z "$NOTARY_PROFILE" ]; then
  echo "Missing Apple notarization keychain profile." >&2
  echo "Set DOWNCITY_NOTARY_PROFILE or APPLE_KEYCHAIN_PROFILE." >&2
  exit 1
fi
if ! command -v xcrun >/dev/null 2>&1; then
  echo "Missing xcrun. Install Xcode command line tools before notarizing." >&2
  exit 1
fi

echo "Current Desktop version: $app_version"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

temporary_directory=$(mktemp -d)
cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT INT TERM

submission_path="$temporary_directory/Downcity.app.zip"
ditto -c -k --keepParent "$APP_PATH" "$submission_path"

echo "Submitting signed app to Apple notarization..."
if [ -n "${APPLE_KEYCHAIN:-}" ]; then
  xcrun notarytool submit "$submission_path" --keychain-profile "$NOTARY_PROFILE" --keychain "$APPLE_KEYCHAIN" --wait
else
  xcrun notarytool submit "$submission_path" --keychain-profile "$NOTARY_PROFILE" --wait
fi

xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
echo "Notarized macOS app: $APP_PATH"
