#!/bin/bash
# Builds Slate and packages it for sharing, in release/:
#   Slate.dmg and Slate.zip (Apple silicon), Slate-Intel.dmg and Slate-Intel.zip (Intel).
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm build
pnpm build:electron

rm -rf release
# electron-builder only assembles and ad-hoc signs Slate.app; the zip and disk image are made below.
pnpm exec electron-builder --mac dir --arm64 --x64 --publish never

package() {
  local app="$1" name="$2"
  # An app with a broken signature opens as "damaged" once downloaded, so refuse to ship one.
  codesign --verify --deep --strict "$app"
  # ditto keeps the app's signature and icon intact, which plain zip can break.
  ditto -c -k --sequesterRsrc --keepParent "$app" "release/$name.zip"

  # A disk image with an Applications shortcut, so installing is one drag.
  local stage
  stage=$(mktemp -d)
  cp -R "$app" "$stage/"
  ln -s /Applications "$stage/Applications"
  hdiutil create -quiet -volname "Slate" -srcfolder "$stage" -fs HFS+ -format UDZO "release/$name.dmg"
  rm -rf "$stage"
}

package release/mac-arm64/Slate.app Slate
package release/mac/Slate.app Slate-Intel

echo "Packaged:"
ls -lh release/*.dmg release/*.zip
