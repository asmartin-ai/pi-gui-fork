#!/bin/bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: verify-linux-release.sh <release-dir> <version>" >&2
  exit 2
fi

release_dir="$(cd "$1" && pwd)"
version="$2"
appimage="$release_dir/pi-gui-$version-x86_64.AppImage"

if [[ ! -f "$appimage" ]]; then
  echo "Missing Linux release artifact: $appimage" >&2
  exit 1
fi

readelf -h "$appimage" | grep -F "Advanced Micro Devices X86-64"
chmod +x "$appimage"

temporary_root="$(mktemp -d)"
cleanup() {
  rm -rf "$temporary_root"
}
trap cleanup EXIT

(
  cd "$temporary_root"
  "$appimage" --appimage-extract >/dev/null
)

extracted="$temporary_root/squashfs-root"
for executable in "$extracted/AppRun" "$extracted/pi-gui"; do
  if [[ ! -x "$executable" ]]; then
    echo "AppImage is missing executable payload: $executable" >&2
    exit 1
  fi
done

if [[ ! -f "$extracted/resources/app.asar" ]]; then
  echo "AppImage is missing resources/app.asar" >&2
  exit 1
fi

readelf -h "$extracted/pi-gui" | grep -F "Advanced Micro Devices X86-64"
echo "Verified x64 architecture and extracted AppImage payload for Linux $version"
