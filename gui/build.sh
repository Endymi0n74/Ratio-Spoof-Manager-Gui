#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/ratio-spoof" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
engine_path="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
source_path="$repo_root/gui/ratio_spoof_manager.py"
assets_path="$repo_root/gui/assets"
dist_path="$repo_root/dist"
build_path="$repo_root/build"

if [[ ! -f "$engine_path" ]]; then
  echo "ratio-spoof was not found: $engine_path" >&2
  exit 1
fi

chmod +x "$engine_path"
mkdir -p "$dist_path" "$build_path"

if [[ "$(uname -s)" == "Darwin" ]]; then
  python -m PyInstaller \
    --noconfirm \
    --clean \
    --windowed \
    --name "RatioSpoofManager" \
    --icon "$assets_path/app-icon.png" \
    --add-binary "$engine_path:." \
    --add-data "$assets_path:assets" \
    --distpath "$dist_path" \
    --workpath "$build_path" \
    --specpath "$build_path" \
    "$source_path"
  ditto -c -k --sequesterRsrc --keepParent \
    "$dist_path/RatioSpoofManager.app" \
    "$dist_path/RatioSpoofManager-macOS.zip"
  echo "Built: $dist_path/RatioSpoofManager-macOS.zip"
else
  python -m PyInstaller \
    --noconfirm \
    --clean \
    --onefile \
    --windowed \
    --name "RatioSpoofManager-Linux-x86_64" \
    --icon "$assets_path/app-icon.png" \
    --add-binary "$engine_path:." \
    --add-data "$assets_path:assets" \
    --distpath "$dist_path" \
    --workpath "$build_path" \
    --specpath "$build_path" \
    "$source_path"
  chmod +x "$dist_path/RatioSpoofManager-Linux-x86_64"
  tar -C "$dist_path" -czf "$dist_path/RatioSpoofManager-Linux-x86_64.tar.gz" \
    "RatioSpoofManager-Linux-x86_64"
  echo "Built: $dist_path/RatioSpoofManager-Linux-x86_64.tar.gz"
fi
