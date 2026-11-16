// How an "Open with" app item's command runs: in the background, given two seconds to fail (a typo, a
// file it can't open). Most app commands (code, cursor, zed, open -a) hand the file to the app and
// leave at once; one that stays open keeps running on its own instead of holding exec (which waits
// for it, up to its 30 s limit, and shows an error then). Its output goes to /dev/null and a temp file,
// never to exec's pipes, which exec would wait on. sh -c DETACH sh <command> <args…>: exits with the
// command's code when it ended within the two seconds (its stderr, cut, on ours), else 0.
import { ID } from "./id.js";

export const DETACH = `e=$(mktemp "\${TMPDIR:-/tmp}/${ID}-open.XXXXXX") || exit 1; ` + '"$@" </dev/null >/dev/null 2>"$e" & p=$!; i=0; '
  + 'while [ $i -lt 20 ]; do if ! kill -0 "$p" 2>/dev/null; then wait "$p"; c=$?; [ $c -eq 0 ] || head -c 400 "$e" >&2; rm -f "$e"; exit $c; fi; sleep 0.1; i=$((i+1)); done; '
  + 'rm -f "$e"; exit 0';
