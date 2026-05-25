#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
DMG_PATH="${ROOT_DIR}/dist/Snapchat-Memories-Importer-${VERSION}.dmg"
APP_NAME="Snapchat Memories Importer.app"
APP_DEST="/Applications/${APP_NAME}"
MOUNT_DIR="$(mktemp -d /tmp/snapchat-importer-dmg.XXXXXX)"

if [[ ! -f "${DMG_PATH}" ]]; then
  echo "DMG not found: ${DMG_PATH}" >&2
  echo "Run npm run dist:mac first, or use npm run update:mac." >&2
  exit 1
fi

cleanup() {
  hdiutil detach "${MOUNT_DIR}" -quiet >/dev/null 2>&1 || true
  rmdir "${MOUNT_DIR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Mounting ${DMG_PATH}"
hdiutil attach "${DMG_PATH}" -mountpoint "${MOUNT_DIR}" -nobrowse -quiet

APP_SRC="${MOUNT_DIR}/${APP_NAME}"
if [[ ! -d "${APP_SRC}" ]]; then
  echo "App bundle not found in mounted DMG: ${APP_SRC}" >&2
  exit 1
fi

osascript -e 'tell application "Snapchat Memories Importer" to quit' >/dev/null 2>&1 || true
rm -rf "${APP_DEST}"
ditto "${APP_SRC}" "${APP_DEST}"

# Local development builds are ad-hoc signed, not notarized. Clearing quarantine
# lets this trusted local install launch on the development Mac.
xattr -dr com.apple.quarantine "${APP_DEST}" >/dev/null 2>&1 || true
codesign --verify --deep --strict "${APP_DEST}"

open -a "${APP_DEST}"
echo "Installed and launched ${APP_DEST}"
