#!/bin/sh
set -eu

# 校验并上传一个已封装的 macOS Desktop release；latest manifest 最后提交。

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd "$SCRIPT_DIR/.." && pwd)
DESKTOP_DIR="$ROOT_DIR/app/desktop"
PACKAGE_JSON="$DESKTOP_DIR/package.json"

. "$SCRIPT_DIR/desktop-release-version.sh"

app_version=$(read_package_version "$PACKAGE_JSON")
bucket="${DOWNCITY_RELEASE_R2_BUCKET:-downcity}"
platform="${DOWNCITY_RELEASE_PLATFORM:-macos-arm64}"
minimum_os="${DOWNCITY_RELEASE_MINIMUM_OS:-12.0}"
signed_by="${DOWNCITY_RELEASE_SIGNED_BY:-Developer ID Application: Zheng Wang (76Y42WCHN4)}"
notarized="${DOWNCITY_RELEASE_NOTARIZED:-true}"
dist_directory="${DOWNCITY_RELEASE_DIST_DIR:-$DESKTOP_DIR/dist}"

if [ -z "$app_version" ]; then
  echo "Unable to read Desktop version from app/desktop/package.json." >&2
  exit 1
fi
if [ "$notarized" != "true" ]; then
  echo "Refusing to publish an unnotarized macOS release." >&2
  exit 1
fi

dmg_path="${DOWNCITY_RELEASE_DMG_PATH:-$dist_directory/downcity-${app_version}.dmg}"
dmg_blockmap_path="${DOWNCITY_RELEASE_DMG_BLOCKMAP_PATH:-$dist_directory/downcity-${app_version}.dmg.blockmap}"
zip_path="${DOWNCITY_RELEASE_ZIP_PATH:-$dist_directory/downcity-${app_version}.zip}"
zip_blockmap_path="${DOWNCITY_RELEASE_ZIP_BLOCKMAP_PATH:-$dist_directory/downcity-${app_version}.zip.blockmap}"
latest_mac_yml_path="${DOWNCITY_RELEASE_LATEST_MAC_YML_PATH:-$dist_directory/latest-mac.yml}"

for required_file in "$dmg_path" "$dmg_blockmap_path" "$zip_path" "$zip_blockmap_path" "$latest_mac_yml_path"; do
  if [ ! -f "$required_file" ]; then
    echo "Missing release artifact: $required_file" >&2
    exit 1
  fi
done

dmg_name=$(basename "$dmg_path")
dmg_blockmap_name=$(basename "$dmg_blockmap_path")
zip_name=$(basename "$zip_path")
zip_blockmap_name=$(basename "$zip_blockmap_path")
latest_mac_yml_name=$(basename "$latest_mac_yml_path")
release_prefix="releases/packages/macos/${app_version}"
dmg_key="$release_prefix/$dmg_name"
dmg_blockmap_key="$release_prefix/$dmg_blockmap_name"
zip_key="$release_prefix/$zip_name"
zip_blockmap_key="$release_prefix/$zip_blockmap_name"
latest_mac_yml_key="$release_prefix/$latest_mac_yml_name"
checksum_key="$dmg_key.sha256"
manifest_key="releases/manifests/macos-latest.json"

published_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
dmg_sha256=$(shasum -a 256 "$dmg_path" | awk '{print $1}')
dmg_size=$(stat -f '%z' "$dmg_path")
zip_sha256=$(shasum -a 256 "$zip_path" | awk '{print $1}')
zip_size=$(stat -f '%z' "$zip_path")

temporary_directory=$(mktemp -d)
cleanup() { rm -rf "$temporary_directory"; }
trap cleanup EXIT INT TERM

checksum_path="$temporary_directory/${dmg_name}.sha256"
manifest_path="$temporary_directory/macos-latest.json"
printf "%s  %s\n" "$dmg_sha256" "$dmg_name" > "$checksum_path"

cat > "$manifest_path" <<EOF
{
  "version": "$app_version",
  "platform": "$platform",
  "minimum_os": "$minimum_os",
  "file": "$dmg_name",
  "path": "$dmg_key",
  "blockmap_path": "$dmg_blockmap_key",
  "zip_file": "$zip_name",
  "zip_path": "$zip_key",
  "zip_blockmap_path": "$zip_blockmap_key",
  "latest_mac_yml_path": "$latest_mac_yml_key",
  "sha256": "$dmg_sha256",
  "size": $dmg_size,
  "zip_sha256": "$zip_sha256",
  "zip_size": $zip_size,
  "signed_by": "$signed_by",
  "notarized": true,
  "published_at": "$published_at"
}
EOF

run_uploader() {
  node \
    --env-file-if-exists="$ROOT_DIR/.env" \
    --env-file-if-exists="$ROOT_DIR/.env.local" \
    "$ROOT_DIR/scripts/r2-multipart-upload.mjs" "$@"
}

put_object() {
  key=$1
  file_path=$2
  content_type=$3
  cache_control=$4
  shift 4
  content_disposition=""
  if [ "$#" -ge 2 ] && [ "$1" = "--content-disposition" ]; then
    content_disposition=$2
  fi
  if [ -n "$content_disposition" ]; then
    run_uploader --bucket "$bucket" --key "$key" --file "$file_path" \
      --content-type "$content_type" --cache-control "$cache_control" \
      --content-disposition "$content_disposition"
  else
    run_uploader --bucket "$bucket" --key "$key" --file "$file_path" \
      --content-type "$content_type" --cache-control "$cache_control"
  fi
}

echo "Publishing Downcity Desktop $app_version to Cloudflare R2 bucket $bucket..."
put_object "$dmg_key" "$dmg_path" "application/x-apple-diskimage" \
  "public, max-age=31536000, immutable" --content-disposition "attachment; filename=\"$dmg_name\""
put_object "$dmg_blockmap_key" "$dmg_blockmap_path" "application/octet-stream" \
  "public, max-age=31536000, immutable"
put_object "$zip_key" "$zip_path" "application/zip" \
  "public, max-age=31536000, immutable" --content-disposition "attachment; filename=\"$zip_name\""
put_object "$zip_blockmap_key" "$zip_blockmap_path" "application/octet-stream" \
  "public, max-age=31536000, immutable"
put_object "$latest_mac_yml_key" "$latest_mac_yml_path" "application/x-yaml; charset=utf-8" \
  "public, max-age=31536000, immutable"
put_object "$checksum_key" "$checksum_path" "text/plain; charset=utf-8" \
  "public, max-age=31536000, immutable"

# latest 是提交指针，允许更新；必须最后上传，避免半成品成为当前版本。
run_uploader --bucket "$bucket" --key "$manifest_key" --file "$manifest_path" \
  --content-type "application/json; charset=utf-8" --cache-control "public, max-age=60" \
  --allow-overwrite true

echo "Published Downcity Desktop DMG: $dmg_key"
echo "Published latest manifest: $manifest_key"
echo "Download route: /download/macos"
