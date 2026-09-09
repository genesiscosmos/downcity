#!/bin/sh
set -eu

# 从已经 staple 的同一份 Downcity.app 生成 DMG、ZIP 与 updater metadata。

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
DESKTOP_DIR="$ROOT_DIR/app/desktop"
PACKAGE_JSON="$DESKTOP_DIR/package.json"
APP_PATH="${DOWNCITY_RELEASE_APP_PATH:-$DESKTOP_DIR/dist/mac-arm64/Downcity.app}"

. "$SCRIPT_DIR/desktop-release-version.sh"

app_version=$(read_package_version "$PACKAGE_JSON")
if [ -z "$app_version" ]; then
  echo "Unable to read Desktop version from app/desktop/package.json." >&2
  exit 1
fi
if [ ! -d "$APP_PATH" ]; then
  echo "Missing notarized app: $APP_PATH" >&2
  echo "Run pnpm desktop:build:mac and pnpm desktop:notarize:mac first." >&2
  exit 1
fi

echo "Current Desktop version: $app_version"
xcrun stapler validate "$APP_PATH"

echo "Packaging DMG and ZIP from notarized app..."
(cd "$DESKTOP_DIR" && pnpm run package:mac)

for required_file in \
  "$DESKTOP_DIR/dist/downcity-${app_version}.dmg" \
  "$DESKTOP_DIR/dist/downcity-${app_version}.dmg.blockmap" \
  "$DESKTOP_DIR/dist/downcity-${app_version}.zip" \
  "$DESKTOP_DIR/dist/downcity-${app_version}.zip.blockmap" \
  "$DESKTOP_DIR/dist/latest-mac.yml"; do
  if [ ! -f "$required_file" ]; then
    echo "Missing packaged artifact: $required_file" >&2
    exit 1
  fi
done

echo "Packaged macOS release artifacts for Downcity $app_version."
