#!/bin/sh
set -eu

# 交互式编排完整 Desktop 发布；默认取消，避免误签名或误发布。

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
PACKAGE_JSON="$ROOT_DIR/app/desktop/package.json"
NOTARY_PROFILE="${DOWNCITY_NOTARY_PROFILE:-${APPLE_KEYCHAIN_PROFILE:-VIBEMEET_NOTARY_PROFILE}}"
SIGNING_IDENTITY="${DOWNCITY_RELEASE_SIGNED_BY:-Developer ID Application: Zheng Wang (76Y42WCHN4)}"

. "$SCRIPT_DIR/desktop-release-version.sh"

if [ ! -t 0 ]; then
  echo "Interactive publish requires a terminal." >&2
  exit 1
fi

current_version=$(read_package_version "$PACKAGE_JSON")
if [ -z "$current_version" ]; then
  echo "Unable to read Desktop version from app/desktop/package.json." >&2
  exit 1
fi

echo "Current Desktop version: $current_version"
echo
echo "Publish summary"
echo "  Platform: macOS arm64"
echo "  Release version: selected by desktop:build:mac"
echo "  Code signing: required"
echo "  Apple notarization: required"
echo "  Notary profile: $NOTARY_PROFILE"
echo "  Artifacts: DMG, ZIP, blockmaps and latest-mac.yml"
echo "  R2 bucket: ${DOWNCITY_RELEASE_R2_BUCKET:-downcity}"
echo "  Download URL: https://downcity.ai/download/macos"
echo

confirm_publish=$(prompt_yes_no "Continue with publish?" "false")
if [ "$confirm_publish" != "true" ]; then
  echo "Publish canceled."
  exit 0
fi

if ! security find-identity -v -p codesigning 2>/dev/null | grep -F "$SIGNING_IDENTITY" >/dev/null 2>&1 && [ -z "${CSC_NAME:-}" ] && [ -z "${CSC_LINK:-}" ]; then
  echo "Missing macOS Developer ID signing credentials for: $SIGNING_IDENTITY" >&2
  exit 1
fi
if [ -z "$NOTARY_PROFILE" ]; then
  echo "Missing Apple notarization keychain profile." >&2
  exit 1
fi

(cd "$ROOT_DIR" && pnpm desktop:build:mac)
(cd "$ROOT_DIR" && pnpm desktop:notarize:mac)
(cd "$ROOT_DIR" && pnpm desktop:package:mac)
(cd "$ROOT_DIR" && pnpm desktop:upload)
