#!/bin/sh
# The layout entry's tab bar (herdr-enhanced/mods/tabs-enhanced) is a copy of Herdr's own (its tabs
# mod) as it ships in the Herdr app 0.1.15, with a History button. Herdr doesn't update a copy. This
# compares the tab bar of the Herdr installed here with the one the copy is based on, and says which
# files changed: copy the new ones in again (its main.js with the changes its top comment lists).
#   tools/check-upstream.sh [HERDR_APP_HOME]   (default ~/.config/herdr-app)
# Exits 0 when they are the same, 1 when Herdr's tab bar changed, 2 when there is none to compare.
set -u
APP=${1:-$HOME/.config/herdr-app}
H="$APP/mods/tabs"
[ -f "$H/main.js" ] || { echo "no Herdr tab bar at $H (is the Herdr app installed?)" >&2; exit 2; }
if command -v sha256sum >/dev/null 2>&1; then sum() { sha256sum "$1" | cut -d' ' -f1; }
else sum() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi
# Herdr 0.1.15's tabs mod, file by file.
BASE='d1368ee4c1dd588adca3c20e015f8bf41c7e99e4b9591c910cc4aba14c90fe26 main.js
bd2a09edf56933dd318e75ce134b2c48aed56010b825f3c936f92a995e686c4d mod.json
bc46f314ea68818459856618e10f694e53cccd947b3069286f1988927e8a1fac win-close.svg
d8f2df2b1c3b3416ab765be0ad0b6f453f4c89e0c01ac01e4e10bd12e01b109a win-max.svg
c2f8d7d1e117f99b73970816877a926becb3da102cd706fd0f0ce1780259cd52 win-min.svg
69ccde33c78d83ce39972ef129e158dd09fb19d3002bd709047801802fbad51d win-restore.svg'
changed=""
for f in $(printf '%s\n' "$BASE" | cut -d' ' -f2); do
  want=$(printf '%s\n' "$BASE" | awk -v f="$f" '$2 == f { print $1 }')
  if [ ! -f "$H/$f" ]; then changed="$changed $f(gone)"; elif [ "$(sum "$H/$f")" != "$want" ]; then changed="$changed $f"; fi
done
# Files Herdr's tab bar has now that 0.1.15's hadn't (its editor files aside).
for p in "$H"/*; do
  f=$(basename "$p")
  case "$f" in gpui-kit.d.ts|jsconfig.json) continue ;; esac
  printf '%s\n' "$BASE" | awk '{ print $2 }' | grep -qx -- "$f" || changed="$changed $f(new)"
done
if [ -z "$changed" ]; then echo "Herdr's tab bar is still the one tabs-enhanced is based on (0.1.15)"; exit 0; fi
echo "Herdr's tab bar changed since 0.1.15:$changed"
echo "copy it into herdr-enhanced/mods/tabs-enhanced again and make the changes its main.js lists at its top"
exit 1
