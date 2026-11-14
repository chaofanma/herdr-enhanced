#!/bin/sh
# The panel's shared modules (shared/*.js) are copied unchanged into each mod of this repository
# (tools/copy-shared.mjs), because a mod can't import from another mod's folder. This checks every
# mod's copies (each <entry>/mods/<mod>/ with a main.js, but the layout entry's tab bar, a copy of
# Herdr's that uses none of them) against shared/; it exits 1 when a copy is missing or differs.
#   tools/check-shared.sh
set -u
cd "$(dirname "$0")/.."
bad=0 n=0
for main in */mods/*/main.js; do
  [ -f "$main" ] || continue
  m=${main%/main.js}
  [ "$m" = herdr-enhanced/mods/tabs-enhanced ] && continue
  for s in shared/*.js; do
    f=$m/${s#shared/}
    if [ ! -f "$f" ]; then echo "missing: $f"; bad=1
    elif ! cmp -s "$s" "$f"; then echo "differs: $f (from $s)"; bad=1; fi
  done
  n=$((n + 1))
done
[ "$n" -gt 0 ] || { echo "no mods found"; exit 1; }
[ $bad = 0 ] && echo "shared copies: all equal ($n mods)"
exit $bad
