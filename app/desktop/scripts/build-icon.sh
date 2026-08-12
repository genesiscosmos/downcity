#!/usr/bin/env bash
set -euo pipefail

# Desktop 图标构建脚本：从统一源图生成各平台需要的图标格式。
app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_icon="$app_dir/resources/icon-source.png"
build_dir="$app_dir/build"
iconset_dir="$build_dir/icon.iconset"
linux_icon_dir="$build_dir/icons"

if [[ ! -f "$source_icon" ]]; then
  echo "Icon source not found: $source_icon" >&2
  exit 1
fi

rm -rf "$iconset_dir" "$linux_icon_dir"
mkdir -p "$iconset_dir" "$linux_icon_dir"

python3 - "$source_icon" "$iconset_dir" "$linux_icon_dir" "$build_dir/icon.ico" "$build_dir/icon.icns" <<'PY'
import sys
from pathlib import Path

from PIL import Image

source_path, iconset_path, linux_path, ico_path, icns_path = map(Path, sys.argv[1:])
source = Image.open(source_path).convert("RGBA")

if source.size != (512, 512):
    raise SystemExit("Desktop icon source must be 512x512")

# macOS 会以更大的视觉占比展示图标，因此将内容缩放到 82% 并保持透明留白。
macos_content_scale = 0.82
macos_content_size = round(source.width * macos_content_scale)
macos_offset = (source.width - macos_content_size) // 2
macos_icon = Image.new("RGBA", source.size, (0, 0, 0, 0))
macos_icon.alpha_composite(
    source.resize((macos_content_size, macos_content_size), Image.Resampling.LANCZOS),
    (macos_offset, macos_offset),
)

iconset_sizes = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}

for filename, size in iconset_sizes.items():
    macos_icon.resize((size, size), Image.Resampling.LANCZOS).save(iconset_path / filename)

for size in (16, 32, 48, 64, 128, 256, 512):
    source.resize((size, size), Image.Resampling.LANCZOS).save(linux_path / f"{size}x{size}.png")

source.save(ico_path, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
macos_icon.save(icns_path, format="ICNS")
PY

echo "Built Downcity desktop icons in $build_dir"
