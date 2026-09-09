#!/bin/sh
set -eu

# 选择 Desktop 版本并生成已签名的 macOS arm64 应用。

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
DESKTOP_DIR="$ROOT_DIR/app/desktop"
PACKAGE_JSON="$DESKTOP_DIR/package.json"
APP_PATH="${DOWNCITY_RELEASE_APP_PATH:-$DESKTOP_DIR/dist/mac-arm64/Downcity.app}"
VERSION_BUMP_DEFAULT="${DOWNCITY_BUILD_MAC_VERSION_BUMP_DEFAULT:-patch}"

. "$SCRIPT_DIR/desktop-release-version.sh"

current_version=$(read_package_version "$PACKAGE_JSON")
if [ -z "$current_version" ]; then
  echo "Unable to read Desktop version from app/desktop/package.json." >&2
  exit 1
fi

echo "Current Desktop version: $current_version"

if [ -n "${DOWNCITY_BUILD_MAC_VERSION_BUMP+x}" ]; then
  version_bump=$DOWNCITY_BUILD_MAC_VERSION_BUMP
elif [ -t 0 ]; then
  version_bump=$(prompt_choice "Version bump" "$VERSION_BUMP_DEFAULT" patch minor major none)
else
  version_bump=none
fi

next_version=$(bump_semver "$current_version" "$version_bump")
if [ "$next_version" != "$current_version" ]; then
  echo "Updating Desktop version: $current_version -> $next_version"
  write_package_version "$PACKAGE_JSON" "$next_version"
fi

echo "Next Desktop version: $next_version"
echo "Version bump: $version_bump"
echo "Building signed macOS arm64 app..."
(cd "$DESKTOP_DIR" && pnpm run build:mac:app)

if [ ! -d "$APP_PATH" ]; then
  echo "Missing built app: $APP_PATH" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
echo "Built signed macOS app: $APP_PATH"
