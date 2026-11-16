// The sh scripts this mod runs on this computer or on a space's machine (machine.js runs them through
// Herdr's exec, which reaches both): POSIX sh and the tools every Unix machine has (git, mktemp, wc,
// tr, cksum, od, sleep, kill), with GNU's and BSD's differences handled (base64 -d or -D, else
// openssl). No perl and no timeout(1): time limits are the sh watchdog below.
// No Herdr imports: tested with node under sh and dash (test/git-enhanced/scripts.test.mjs).
// Based on Herdr's shipped changes mod (Apache-2.0); changed: READ, the read-only git flags.
import { Buffer } from "buffer";
import { ID } from "./id.js";

/** base64 characters per argument, a multiple of 4: each stays under Linux's 128 KiB for one argument
 *  (exec has no stdin, so bytes for the far side travel as arguments). */
export const CHUNK = 98304;
/** The most bytes one call carries when the machine's ARG_MAX isn't known. */
export const PUT_MAX = 600 * 1024;
/** How many bytes fit a machine whose ARG_MAX is `argMax`: base64 is 4/3 of them, and the
 *  environment and the script take their share (64 KiB kept for them). */
export const putCap = (argMax) => (argMax > 0 ? Math.max(0, Math.min(1024 * 1024, Math.floor((argMax - 65536) * 3 / 4))) : PUT_MAX);

/** `b64` cut into pieces of `size` characters (the last one shorter). */
export function chunks(b64, size = CHUNK) {
  const out = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}

// The decoder a machine has: base64 -d (GNU, busybox, newer macOS), -D (older macOS), else openssl.
const DECODER = 'if [ "$(printf QQ== | base64 -d 2>/dev/null)" = A ]; then dec="base64 -d"; '
  + 'elif [ "$(printf QQ== | base64 -D 2>/dev/null)" = A ]; then dec="base64 -D"; '
  + 'elif [ "$(printf QQ== | openssl base64 -d -A 2>/dev/null)" = A ]; then dec="openssl base64 -d -A"; '
  + 'else echo "Decoding there needs base64 or openssl" >&2; exit 5; fi; ';

/** The start of a script that gets files: `sh -c FILES_SH + body sh <count> [<name> <bytes> <pieces>
 *  <piece>…]… <args…>` (filesArgs). Each file's pieces are decoded into "$d/<name>", a temp folder
 *  removed when the script ends (so the body must not `exec`), and its length is checked; the body
 *  then runs with "$@" the arguments after the files. Exit 5: nothing there decodes base64. */
export const FILES_SH = DECODER
  + `d=$(mktemp -d "\${TMPDIR:-/tmp}/${ID}.XXXXXX") || exit 1; trap 'rm -rf "$d"' EXIT; trap 'exit 143' HUP INT TERM; `
  + 'n=$1; shift; while [ "$n" -gt 0 ]; do name=$1 len=$2 k=$3; shift 3; '
  + 'case $name in ""|.|..|*/*) echo "A bad file name" >&2; exit 2;; esac; : > "$d/$name" || exit 1; '
  + 'while [ "$k" -gt 0 ]; do printf "%s" "$1" | $dec >> "$d/$name" || exit 1; shift; k=$((k - 1)); done; '
  + '[ "$(wc -c < "$d/$name" | tr -d " ")" = "$len" ] || { echo "$name arrived cut short" >&2; exit 1; }; '
  + 'n=$((n - 1)); done; ';

/** A file for FILES_SH: `text` (a string, as UTF-8) or bytes, as { name, base64, size }. */
export function fileOf(name, text) {
  const b = typeof text === "string" ? Buffer.from(text, "utf8") : Buffer.from(text);
  return { name, base64: b.toString("base64"), size: b.length };
}

/** FILES_SH's arguments for `files` ([{ name, base64, size }]: `size` the bytes, `base64` them
 *  encoded), before the body's own `args`. */
export function filesArgs(files, args = []) {
  const out = [String(files.length)];
  for (const f of files) {
    const pieces = chunks(f.base64);
    out.push(f.name, String(f.size), String(pieces.length), ...pieces);
  }
  return [...out, ...args.map(String)];
}

/** The watchdog, a function for the start of a script: `limit SECONDS OUT ERR CMD ARGS…` runs CMD
 *  with its output in the files OUT and ERR (never in this script's pipes, fd 3 closed, so nothing it
 *  leaves behind keeps Herdr's exec waiting) and stdin from /dev/null, and stops it after SECONDS: TERM
 *  to its process group when the shell gave it one (`set -m`; bash does, dash without a terminal
 *  doesn't), else to it, then KILL two seconds later. Returns CMD's exit status, 142 when stopped
 *  (as an alarm would). With job control on, the shell reports finished jobs on its stderr, so a
 *  script that starts with this one writes its own messages to fd 3 (the caller's stderr; `>&3`,
 *  `2>&3`): fd 2 goes to /dev/null. */
export const LIMIT_SH = 'exec 3>&2 2>/dev/null; set -m; '
  + 'limit() { _s=$1 _o=$2 _e=$3; shift 3; _m="$_o.stopped"; rm -f "$_m"; '
  + '"$@" > "$_o" 2> "$_e" < /dev/null 3>&- & _p=$!; '
  + '( sleep "$_s"; : > "$_m"; kill -TERM -- "-$_p" 2>/dev/null || kill -TERM "$_p" 2>/dev/null; sleep 2; kill -KILL -- "-$_p" 2>/dev/null || kill -KILL "$_p" 2>/dev/null ) > /dev/null 2>&1 3>&- & _w=$!; '
  + 'wait "$_p"; _c=$?; kill "$_w" 2>/dev/null; '
  + 'if [ -e "$_m" ]; then rm -f "$_m"; return 142; fi; return "$_c"; }; ';

/** Read-only git: no optional locks, no fsmonitor, no index refresh (what Herdr's Changes mod reads
 *  with), so a look writes nothing under .git that a watch would see. */
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const R = READ.join(" ");

/** One line that changes whenever the repository's state does (what a copy polls on a machine
 *  watchFolder doesn't reach): HEAD, every ref, the status (untracked files too), the staged and
 *  unstaged diffs, and the files named in its arguments (an untracked file shown in full).
 *  `sh -c STATE_SH sh <file>…` in the repository; "none" outside one. */
export const STATE_SH = 'git rev-parse --git-dir >/dev/null 2>&1 || { echo none; exit 0; }; '
  + `{ git rev-parse -q --verify HEAD; git for-each-ref --format="%(objectname) %(refname)"; git ${R} status --porcelain=v1 -z --untracked-files=all; `
  + `git ${R} diff --no-ext-diff --no-textconv --no-color --cached; git ${R} diff --no-ext-diff --no-textconv --no-color; `
  + 'for f; do [ -f "$f" ] && cksum < "$f"; done; } 2>/dev/null | cksum';

/** What a machine has: `sh -c PROBE sh <program>…` prints its system's name, its ARG_MAX, then each
 *  program it finds, a line each. */
export const PROBE = 'uname -s 2>/dev/null || echo unknown; getconf ARG_MAX 2>/dev/null || echo 0; '
  + 'for c in "$@"; do command -v "$c" >/dev/null 2>&1 && printf "%s\\n" "$c"; done; exit 0';

/** PROBE's output: { os, argMax, tools: Set }. */
export function parseFacts(stdout) {
  const lines = String(stdout ?? "").split("\n").map((s) => s.trim());
  return { os: lines[0] || "unknown", argMax: Number(lines[1]) || 0, tools: new Set(lines.slice(2).filter(Boolean)) };
}

/** The first line of a failed program's message, or `or`. */
export const why = (stderr, or = "") => String(stderr ?? "").trim().split("\n")[0] || or;
