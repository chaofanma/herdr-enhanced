#!/bin/sh
# The herdr-enhanced/ entry's mods are copies of the two mods' own entries (tools/make-entry.mjs),
# and its own tab bar (tabs-enhanced, no copy). This checks each copy holds the same files with the
# same bytes; it exits 1 when one is missing, extra or different.
#   tools/check-copies.sh
set -u
cd "$(dirname "$0")/.."
bad=0
for pair in "files-enhanced/mods/files-enhanced herdr-enhanced/mods/files-enhanced" "git-enhanced/mods/git-enhanced herdr-enhanced/mods/git-enhanced"; do
  set -- $pair
  if [ ! -d "$2" ]; then echo "missing: $2 (node tools/make-entry.mjs)"; bad=1; continue; fi
  diff -r -q "$1" "$2" || { echo "differs: $2 from $1 (node tools/make-entry.mjs)"; bad=1; }
done
# Nothing else under the entry's mods/.
for d in herdr-enhanced/mods/*; do
  case $d in herdr-enhanced/mods/files-enhanced|herdr-enhanced/mods/git-enhanced|herdr-enhanced/mods/tabs-enhanced) ;; *) echo "extra: $d"; bad=1 ;; esac
done
[ $bad = 0 ] && echo "herdr-enhanced/mods: both copies equal"
exit $bad
