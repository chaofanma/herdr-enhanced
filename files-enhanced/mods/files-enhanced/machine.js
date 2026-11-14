// Based on Herdr's shipped Files mod (Apache-2.0); changed: its listing (the entry loop of LIST, the
// PowerShell folder) grew into the machine layer.
// The machine layer: every file operation the panel makes, on this computer or on the space's machine
// (`on`: a name from `hc machine ls`, null for this computer). Mods run here. exec and readTextFile
// reach another machine; writeTextFile, watchFolder and image() don't. So everything runs as a POSIX sh
// script through exec, which works on both ends: the other machine may be Linux, BSD or macOS, so the
// scripts stay portable (GNU's stat -c or BSD's stat -f, base64 -d or -D, no `timeout`, no perl).
// Windows here (no sh) lists and changes files with PowerShell instead; there the sh-only features
// (paste, search, compress) are left out, as capsOf() says.
import { exec, readTextFile, writeTextFile, window, appHome } from "herdr";
import * as fs from "fs/promises";
import { Buffer } from "buffer";
import { createHash } from "crypto";
import { ID } from "./id.js";
import { splitName } from "./names.js";
import { TRANSFER, parseTransfer, nameArgs } from "./paste.js";
import { patterns } from "./fuzzy.js";
import { parseTimes } from "./ages.js";
import { findArgs, reposOf } from "./repos.js";

// This computer's system: "macos", "linux" or "windows" (Herdr's window() says).
export function platform() {
  const w = window();
  return w ? w.platform : "linux";
}
const windowsHere = on => !on && platform() === "windows";

// `sh -c script sh args…` on `on` (here when null), in `cwd`. Resolves exec's { code, stdout, stderr };
// rejects when sh can't start (Windows) or the machine can't be reached.
export function sh(on, script, args = [], { cwd, timeout } = {}) {
  return exec("sh", ["-c", script, "sh", ...args.map(String)], { on: on ?? null, cwd, timeout });
}

// The first line of a failed program's stderr (osascript's "0:85: execution error: " cut off), or `or`.
export const why = (stderr, or = "") => String(stderr ?? "").trim().split("\n")[0].replace(/^\d+:\d+: execution error: /, "") || or;
const message = e => String(e?.message ?? e);

// ---- What a machine has

// The programs some features need, looked for once per machine (and again after ten minutes).
export const TOOLS = ["git", "rg", "fd", "fdfind", "zip", "ditto", "gio", "trash", "trash-put", "base64", "openssl"];
// sh -c PROBE sh <program>…: the system's name, ARG_MAX, then each program found, a line each.
export const PROBE = 'uname -s 2>/dev/null || echo unknown; getconf ARG_MAX 2>/dev/null || echo 0; '
  + 'for c in "$@"; do command -v "$c" >/dev/null 2>&1 && printf "%s\\n" "$c"; done; exit 0';

export function parseFacts(stdout) {
  const lines = String(stdout ?? "").split("\n").map(s => s.trim());
  return { os: lines[0] || "unknown", argMax: Number(lines[1]) || 0, tools: new Set(lines.slice(2).filter(Boolean)), sh: true };
}
const NO_SH = { os: "Windows", argMax: 32767, tools: new Set(), sh: false };
const FACTS = new Map(); // on ("" here) -> { at, value, promise }
const FACTS_TTL = 10 * 60 * 1000;

// What `on` has: { os, argMax, tools: Set, sh }. One sh per machine; a failed probe isn't kept.
export function facts(on) {
  const k = on ?? "", was = FACTS.get(k);
  if (was && (!was.value || Date.now() - was.at < FACTS_TTL)) return was.promise;
  const entry = { at: Date.now(), value: was?.value ?? null };
  entry.promise = (async () => {
    if (windowsHere(on)) return (entry.value = NO_SH);
    try {
      const r = await sh(on, PROBE, TOOLS, { timeout: 15000 });
      entry.value = parseFacts(r.stdout);
    } catch (e) {
      if (!/cannot start sh|program not found/i.test(message(e))) { if (FACTS.get(k) === entry) FACTS.delete(k); throw e; }
      entry.value = NO_SH;
    }
    entry.at = Date.now();
    return entry.value;
  })();
  FACTS.set(k, entry);
  return entry.promise;
}
// The facts already found for `on`, or null.
export const known = on => FACTS.get(on ?? "")?.value ?? null;
// For tests: forget them.
export const forget = () => FACTS.clear();

// What the panel can do on `on`, from its facts (`f`; null while they're being found, or when finding
// them failed: `known` false): the menus show what it can, and say why when something isn't there.
// Saving (`write`) is null while not known, neither offered as sure nor refused: writeText finds out.
export function capsOf(on, f = known(on)) {
  const has = c => Boolean(f?.tools?.has(c)), here = !on, os = here ? platform() : f?.os === "Darwin" ? "macos" : f?.os === "Linux" ? "linux" : "other";
  const shell = here ? platform() !== "windows" : f ? f.sh !== false : true;
  return {
    os,
    known: here || Boolean(f),
    shell,                                     // the sh features: paste, duplicate, move, search, compress
    // A Mac always has ditto (Finder's Compress); elsewhere zip is needed.
    zip: shell && ((here && os === "macos") || has("zip") || (os === "macos" && has("ditto"))),
    // How Delete puts things away: a Trash (here always; Linux needs gio), or null: gone for good.
    trash: here ? (os === "macos" ? "finder" : os === "windows" ? "recycle" : "gio")
      : !shell ? null : has("gio") ? "gio" : has("trash-put") ? "trash-put" : os === "macos" && has("trash") ? "trash" : null,
    write: here || (!f ? null : shell && (has("base64") || has("openssl"))),
    writeMax: here ? Infinity : writeCap(f?.argMax),
    fd: has("fd") ? "fd" : has("fdfind") ? "fdfind" : null,
  };
}

// ---- Listing

export const PER_FOLDER = 1000;
// sh -c LIST sh <limit> <chains: 1 | 0> <folder>…: for each folder "D" and its path, then its entries
// ("d" or "f" and the name; .git left out), "+" past <limit>, or "E" and why it can't be listed. With
// chains, the start of each of its folders' single-folder chains (Compact folders): "c", the path from
// the folder, and its entries ("d", "f" or "g" for .git, then the name, joined by "/"; up to 8),
// followed down while a folder holds exactly one folder and no .git (10 deep, 200 folders). Fields end
// in NUL. The entry loop is Herdr's Files mod's (a link to a folder is a folder).
export const LIST = 'limit=$1 chains=$2; shift 2; '
  + 'walk() { wa=$1 wr=$2 wk=0; while [ "$wk" -lt 10 ]; do kids= nd=0 nk=0 one= git=0; '
  + 'for wp in "$wa"/* "$wa"/.[!.]* "$wa"/..?*; do [ -e "$wp" ] || [ -L "$wp" ] || continue; wn=${wp##*/}; nk=$((nk+1)); [ "$nk" -gt 8 ] && return 0; '
  + 'if [ "$wn" = .git ]; then git=1; kids="$kids/g$wn"; elif [ -d "$wp" ]; then nd=$((nd+1)); one=$wn; kids="$kids/d$wn"; else kids="$kids/f$wn"; fi; done; '
  + 'printf "c\\0%s\\0%s\\0" "$wr" "${kids#/}"; [ "$git" = 0 ] && [ "$nd" = 1 ] || return 0; wa=$wa/$one wr=$wr/$one wk=$((wk+1)); done; }; '
  + 'for d; do printf "D\\0%s\\0" "$d"; '
  + 'if [ ! -d "$d" ]; then printf "E\\0%s\\0" "No such folder"; continue; fi; '
  + 'if [ ! -r "$d" ] || [ ! -x "$d" ]; then printf "E\\0%s\\0" "Permission denied"; continue; fi; '
  + 'n=0; for p in "$d"/* "$d"/.[!.]* "$d"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; '
  + 'n=$((n+1)); if [ "$n" -gt "$limit" ]; then printf "+\\0\\0"; break; fi; if [ -d "$p" ]; then printf "d\\0%s\\0" "$name"; else printf "f\\0%s\\0" "$name"; fi; done; '
  + 'if [ "$chains" = 1 ]; then m=0; for p in "$d"/* "$d"/.[!.]* "$d"/..?*; do [ -d "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; '
  + 'm=$((m+1)); [ "$m" -gt 200 ] && break; walk "$p" "$name"; done; fi; done; exit 0';

// LIST's output: a Map of folder -> { entries: [{ name, dir }], more, error, steps: Map path -> [{ name,
// dir, git }] } (steps: what each folder on a chain's way holds, by its path from the listed folder).
export function parseList(stdout) {
  const f = String(stdout ?? "").split("\0"), out = new Map();
  let cur = null;
  for (let i = 0; i < f.length - 1;) {
    const kind = f[i];
    if (kind === "D") { cur = { entries: [], more: false, error: null, steps: new Map() }; out.set(f[i + 1], cur); i += 2; }
    else if (!cur) i += 2;
    else if (kind === "d" || kind === "f") { cur.entries.push({ name: f[i + 1], dir: kind === "d" }); i += 2; }
    else if (kind === "+") { cur.more = true; i += 2; }
    else if (kind === "E") { cur.error = f[i + 1]; i += 2; }
    else if (kind === "c") {
      const kids = f[i + 2] ? f[i + 2].split("/").map(k => ({ name: k.slice(1), dir: k[0] !== "f", git: k[0] === "g" })) : [];
      cur.steps.set(f[i + 1], kids); i += 3;
    } else i += 2;
  }
  return out;
}

// From Herdr's Files mod: a folder on Windows (here, or a machine without sh) with PowerShell, which
// otherwise uses the console code page (exec decodes UTF-8). Links keep directory attributes even when
// dangling: their target is checked. Other reparse points (OneDrive's folders) have no LinkType and are
// folders. PowerShell reads curly single quotes as quotes too, so they're doubled like '.
async function windowsFolder(path, on, limit) {
  const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First " + (limit + 1) + " | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
  if (r.code !== 0) throw new Error(why(r.stderr, "Cannot list this folder"));
  const result = JSON.parse(r.stdout || "[]");
  return Array.isArray(result) ? result : [result];
}

// Several folders at once (one sh): parseList's Map. Windows: one PowerShell per folder, no chains.
export async function listFolders(on, folders, { limit = PER_FOLDER, chains = false } = {}) {
  const viaPowerShell = async () => {
    const out = new Map();
    for (const d of folders) {
      try { const all = await windowsFolder(d, on, limit); out.set(d, { entries: all.slice(0, limit), more: all.length > limit, error: null, steps: new Map() }); }
      catch (e) { out.set(d, { entries: [], more: false, error: message(e), steps: new Map() }); }
    }
    return out;
  };
  if (windowsHere(on)) return viaPowerShell();
  let r;
  try { r = await sh(on, LIST, [String(limit), chains ? "1" : "0", ...folders], { timeout: 20000 }); }
  catch (e) { if (on && /cannot start sh|program not found/i.test(message(e))) return viaPowerShell(); throw e; }
  if (r.code !== 0) throw new Error(why(r.stderr, "Cannot list this folder"));
  return parseList(r.stdout);
}

// One folder's entries (throws when it can't be listed).
export async function listFolder(on, path, opts) {
  const got = (await listFolders(on, [path], opts)).get(path);
  if (!got || got.error) throw new Error(got?.error ?? "Cannot list this folder");
  return got.entries;
}

// ---- Reading and writing text

export const readText = (on, path) => readTextFile(path, { on: on ?? null });

// POSIX cksum's CRC (what `cksum` prints first) of bytes: the check a save on another machine makes
// that the file still holds what was read. Not a cryptographic hash: it catches a change, not an attack.
let TABLE = null;
export function cksum(bytes) {
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; TABLE[i] = c >>> 0; }
  }
  let crc = 0;
  const step = b => { crc = ((crc << 8) ^ TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0; };
  for (let i = 0; i < bytes.length; i++) step(bytes[i]);
  for (let n = bytes.length; n > 0; n = Math.floor(n / 256)) step(n & 0xff);
  return (~crc) >>> 0;
}
// What WRITE compares the file with: "<cksum> <bytes>", as cksum prints them.
export function expectOf(text) { const b = Buffer.from(text, "utf8"); return `${cksum(b)} ${b.length}`; }

// A save on another machine goes as base64 in arguments: exec has no stdin there. Each argument stays
// under Linux's 128 KiB per argument, and all of them under the machine's ARG_MAX (macOS: 1 MiB),
// so a save is at most REMOTE_WRITE bytes, less where ARG_MAX is smaller.
export const CHUNK = 98304; // base64 characters per argument, a multiple of 4
export const REMOTE_WRITE = 1024 * 1024;
export const writeCap = argMax => (argMax > 0 ? Math.max(0, Math.min(REMOTE_WRITE, Math.floor((argMax - 65536) * 3 / 4))) : REMOTE_WRITE);
export function chunks(b64, size = CHUNK) {
  const out = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}

// sh -c WRITE sh <file> <expected: "-" for a new file, else "<cksum> <bytes>"> <bytes> <base64>…: the
// text decoded into a temp file in the same folder (so the move is atomic), its length checked, then,
// only if the file still holds the expected text (or, for a new file, nothing is there), moved over it
// with the old file's mode (a symlink: written through). Exit 3: the file changed (or exists, or is
// gone); 5: no base64 or openssl to decode with. Prints "ok".
export const WRITE = 'f=$1 want=$2 len=$3; shift 3; d=$(dirname -- "$f") b=$(basename -- "$f"); '
  + 'if [ "$(printf QQ== | base64 -d 2>/dev/null)" = A ]; then dec="base64 -d"; elif [ "$(printf QQ== | base64 -D 2>/dev/null)" = A ]; then dec="base64 -D"; '
  + 'elif [ "$(printf QQ== | openssl base64 -d -A 2>/dev/null)" = A ]; then dec="openssl base64 -d -A"; else echo "Saving there needs base64 or openssl" >&2; exit 5; fi; '
  + 't=$(mktemp "$d/.$b.XXXXXX" 2>/dev/null) || { t="$d/.$b.$$.part"; ( set -C; : > "$t" ) 2>/dev/null || { echo "Cannot write in $d" >&2; exit 1; }; }; '
  + 'trap \'rm -f "$t"\' EXIT; '
  + 'for c; do printf "%s" "$c" | $dec || exit 1; done > "$t" || exit 1; '
  + '[ "$(wc -c < "$t" | tr -d " ")" = "$len" ] || { echo "The text arrived cut short" >&2; exit 1; }; '
  + 'm=; if [ "$want" = - ]; then if [ -e "$f" ] || [ -L "$f" ]; then echo "$b already exists" >&2; exit 3; fi; '
  + 'else [ -f "$f" ] || { echo "$b is gone" >&2; exit 3; }; now=$(set -- $(cksum < "$f"); printf "%s %s" "$1" "$2"); '
  + '[ "$now" = "$want" ] || { echo "$b changed on disk" >&2; exit 3; }; '
  + 'if stat -c %a / >/dev/null 2>&1; then m=$(stat -L -c %a -- "$f" 2>/dev/null); else m=$(stat -L -f %Lp -- "$f" 2>/dev/null); fi; fi; '
  + '[ -n "$m" ] || m=$(printf "%o" $((0666 & ~$(umask)))); chmod "$m" "$t" 2>/dev/null; '
  + 'if [ -L "$f" ]; then cat "$t" > "$f" || exit 1; else mv -f -- "$t" "$f" || exit 1; fi; echo ok';

const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

// Writes text only if the file still holds `expected` (null: only if there is no file), as Herdr's
// writeTextFile does here. Rejects with { stale: true } when it changed.
export async function writeText(on, path, text, expected) {
  if (!on) return writeTextFile(path, text, expected);
  const caps = capsOf(on, await facts(on));
  if (!caps.write) throw new Error(`Saving on ${on} needs base64 or openssl there`);
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > caps.writeMax) throw new Error(`Too big to save on ${on} (${kb(bytes.length)}): Herdr's exec takes up to ${kb(caps.writeMax)} there`);
  const want = expected == null ? "-" : expectOf(expected);
  const r = await sh(on, WRITE, [path, want, String(bytes.length), ...chunks(bytes.toString("base64"))], { timeout: 60000 });
  if (r.code === 0) return null;
  const err = new Error(why(r.stderr, `Saving failed (${r.code})`));
  if (r.code === 3) err.stale = true;
  throw err;
}

// ---- Times and sizes

// stat's "<seconds>\t<path>" for its arguments, GNU's (-c) or BSD's (-f), whichever the machine has.
const STAT = 'if stat -c %Y / >/dev/null 2>&1; then stat -c "%Y\t%n" -- "$@"; else stat -f "%m\t%N" -- "$@"; fi 2>/dev/null; exit 0';

// When files under root changed (rels, the first 500): a Map of rel -> ms; missing ones left out.
export async function mtimes(on, root, rels) {
  if (!rels.length || windowsHere(on)) return new Map();
  const r = await sh(on, STAT, rels.slice(0, 500), { cwd: root }).catch(() => null);
  return parseTimes(r?.stdout);
}

// When each of a folder's entries changed (sorting by modified): a Map of name -> ms, one stat per 400.
export async function times(on, dir, names) {
  const out = new Map();
  if (windowsHere(on)) return out;
  for (let i = 0; i < names.length; i += 400) {
    const r = await sh(on, STAT, names.slice(i, i + 400), { cwd: dir }).catch(() => null);
    for (const [name, ms] of parseTimes(r?.stdout)) out.set(name, ms);
  }
  return out;
}

// sh -c INFO sh <path>…: "<kind> <seconds> <bytes>" a line per path, in order; kind d, f, or x (not
// there). What the poll of a folder on another machine compares, and an image's cache key.
export const INFO = 'if stat -c %Y / >/dev/null 2>&1; then g=1; else g=0; fi; for p; do if [ -e "$p" ]; then if [ -d "$p" ]; then k=d; else k=f; fi; '
  + 'if [ $g = 1 ]; then s=$(stat -L -c "%Y %s" -- "$p" 2>/dev/null); else s=$(stat -L -f "%m %z" -- "$p" 2>/dev/null); fi; printf "%s %s\\n" "$k" "${s:-0 0}"; '
  + 'else echo "x 0 0"; fi; done; exit 0';
export const parseInfo = stdout => String(stdout ?? "").split("\n").filter(Boolean).map(l => { const [kind, s, size] = l.split(" "); return { kind, mtime: Number(s) * 1000, size: Number(size) }; });
export async function info(on, paths) {
  const r = await sh(on, INFO, paths, { timeout: 15000 });
  return parseInfo(r.stdout);
}

// ---- Changing files

// PowerShell with each value as a base64 argument, so no quoting can go wrong: the script finds them
// decoded in $v (Windows here; untested).
async function powershell(body, values) {
  const script = "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $ErrorActionPreference = 'Stop'; "
    + "$v = @($args | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }); " + body;
  const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& { ${script} } ${values.map(x => `'${Buffer.from(String(x), "utf8").toString("base64")}'`).join(" ")}`]);
  if (r.code !== 0) throw new Error(why(r.stderr, "PowerShell failed"));
  return r.stdout;
}

async function shOrSay(on, script, args, fallback, opts) {
  const r = await sh(on, script, args, opts);
  if (r.code !== 0) throw new Error(why(r.stderr, fallback));
  return r.stdout;
}

// sh -c MAKE sh <path> <d | f>: a folder (and the ones above it), or an empty file in a folder made if
// needed ("a/b.txt" makes a). Never over something that is there.
export const MAKE = 'p=$1; if [ -e "$p" ] || [ -L "$p" ]; then echo "$(basename -- "$p") already exists" >&2; exit 1; fi; '
  + 'if [ "$2" = d ]; then mkdir -p -- "$p"; else mkdir -p -- "$(dirname -- "$p")" && ( set -C; : > "$p" ); fi';
export function makeEntry(on, full, dir) {
  if (windowsHere(on)) return powershell("if (Test-Path -LiteralPath $v[0]) { throw ((Split-Path -Leaf $v[0]) + ' already exists') }; "
    + "if ($v[1] -eq 'd') { $null = New-Item -ItemType Directory -Path $v[0] } else { $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $v[0]); $null = New-Item -ItemType File -Path $v[0] }", [full, dir ? "d" : "f"]);
  return shOrSay(on, MAKE, [full, dir ? "d" : "f"], "Couldn't create it");
}

// sh -c RENAME sh <path> <new name>: in the same folder, never over another file. A new name that
// differs only in case (on a disk that ignores case, the same file) goes by way of a temp name.
export const RENAME = 'src=$1 dst=$(dirname -- "$1")/$2; if [ -e "$dst" ] || [ -L "$dst" ]; then '
  + 'if [ "$src" -ef "$dst" ] && [ "$(basename -- "$src")" != "$2" ]; then t="$src.rename-$$"; mv -- "$src" "$t" && mv -- "$t" "$dst"; exit; fi; '
  + 'echo "$2 already exists" >&2; exit 1; fi; mv -- "$src" "$dst"';
export function renameEntry(on, full, name) {
  if (windowsHere(on)) return powershell("Rename-Item -LiteralPath $v[0] -NewName $v[1]", [full, name]);
  return shOrSay(on, RENAME, [full, name], "Couldn't rename it");
}

// sh -c TRASH sh <how> <path>: to the machine's Trash with gio, trash-put or macOS's trash, else
// (how "rm") gone for good.
export const TRASH = 'how=$1 p=$2; [ -e "$p" ] || [ -L "$p" ] || { echo "It is already gone" >&2; exit 1; }; '
  + 'case $how in gio) gio trash -- "$p" ;; trash-put) trash-put -- "$p" ;; trash) trash "$p" ;; *) rm -rf -- "$p" ;; esac';

// Finder's delete (Put Back works). Refused (no Automation permission): macOS 14's own trash command,
// which needs none, else why.
async function finderTrash(full) {
  const script = `tell application "Finder" to delete POSIX file ${JSON.stringify(full)}`, r = await exec("osascript", ["-e", script]);
  if (r.code === 0) return;
  if (/-1743|not authori[sz]ed to send apple events/i.test(r.stderr)) {
    const t = await exec("/usr/bin/trash", [full]).catch(() => null);
    if (t?.code === 0) return;
    throw new Error("Herdr may not control Finder: System Settings → Privacy & Security → Automation → Herdr → Finder");
  }
  throw new Error(why(r.stderr, "Finder couldn't move it to the Trash"));
}

// Delete: here to the Trash (Recycle Bin), or an error saying why, never for good; on another machine
// the way capsOf(on).trash says (null: for good, which the dialog said).
export async function trashEntry(on, full) {
  if (!on) {
    if (platform() === "windows") return powershell("Add-Type -AssemblyName Microsoft.VisualBasic; $o = [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs; $r = [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin; "
      + "if (Test-Path -LiteralPath $v[0] -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($v[0], $o, $r) } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($v[0], $o, $r) }", [full]);
    if (platform() === "macos") return finderTrash(full);
    const r = await exec("gio", ["trash", "--", full]).catch(() => null);
    if (r?.code === 0) return;
    throw new Error(r ? why(r.stderr, "gio couldn't move it to the Trash") : "Can't move it to the Trash: gio isn't installed");
  }
  const how = capsOf(on, await facts(on)).trash ?? "rm";
  await shOrSay(on, TRASH, [how, full], "Couldn't delete it", { timeout: 60000 });
}

// Copies or moves absolute paths into the folder `dest` (here or there), each named the way paste.js
// says (`copy`: "a copy.txt" rather than "a 2.txt"); never over anything. items: [{ src, copy }].
// Resolves { results: [{ src, status: "ok" | "gone" | "fail", name }], why }.
export async function transfer(on, mode, items, dest) {
  const args = items.flatMap(x => [x.src, ...nameArgs(x.src.replace(/\/+$/, "").split("/").pop(), x.copy)]);
  const r = await sh(on, TRANSFER, [mode, dest, ...args], { timeout: 120000 });
  const done = parseTransfer(r.stdout);
  return { results: items.map((x, i) => ({ src: x.src, status: done[i]?.status ?? "fail", name: done[i]?.status === "ok" ? done[i].value : null })), why: why(r.stderr) };
}

// Compresses items of the folder `dir` (paths relative to it) into the .zip `name` there, never over
// something already there: one item on a Mac with ditto (what Finder's Compress runs, resource forks in
// __MACOSX), else zip -r (symlinks kept as links).
const ZIP = 'd=$1 z=$2 how=$3; shift 3; cd "$d" || exit 1; if [ -e "$z" ] || [ -L "$z" ]; then echo "$z already exists" >&2; exit 1; fi; '
  + 'if [ "$how" = ditto ]; then ditto -c -k --sequesterRsrc --keepParent "$1" "$z"; else zip -q -r -y "$z" "$@"; fi';
export async function compress(on, dir, rels, name) {
  const caps = capsOf(on, await facts(on).catch(() => null)), f = known(on);
  const how = rels.length === 1 && caps.os === "macos" && (!on || f?.tools?.has("ditto")) ? "ditto" : "zip";
  const r = await sh(on, ZIP, [dir, name, how, ...rels.map(x => `./${x}`)], { timeout: 300000 });
  if (r.code !== 0) throw new Error(why(r.stderr, how === "zip" && r.code === 127 ? "zip isn't installed" : "Couldn't compress"));
}

// Files dropped from outside (this computer's), copied into a folder here, one by one. A name already
// there gets a number, as in Finder (names.js: "a 2.txt"). Resolves the names the copies got.
const COPY = 'd=$1; shift; while [ $# -ge 3 ]; do s=$1 stem=$2 ext=$3; shift 3; if [ -d "$s" ] && [ ! -L "$s" ]; then stem=$stem$ext; ext=; fi; '
  + 'name=$stem$ext n=1; while [ -e "$d/$name" ] || [ -L "$d/$name" ]; do n=$((n+1)); name="$stem $n$ext"; done; cp -R -- "$s" "$d/$name" || exit 1; printf "%s\\0" "$name"; done';
export async function copyDropped(paths, dest) {
  if (platform() === "windows") {
    await powershell("Copy-Item -LiteralPath $v[1..($v.Count - 1)] -Destination $v[0] -Recurse", [dest, ...paths]);
    return paths.map(p => p.split(/[\\/]/).pop());
  }
  const out = await shOrSay(null, COPY, [dest, ...paths.flatMap(p => [p, ...splitName(p.replace(/\/+$/, "").split("/").pop())])], "Couldn't copy it", { timeout: 300000 });
  return out.split("\0").filter(Boolean);
}

// Whether a folder is gone; false when it can't tell (its machine is away, say).
export async function gone(on, path) {
  if (windowsHere(on)) return fs.exists(path).then(there => !there, () => false);
  const r = await sh(on, '[ -d "$1" ]', [path]).catch(() => null);
  return r?.code === 1;
}

// ---- Searching file names

// The search box's files under root: fd (or Debian's fdfind) with a fuzzy pattern per word (fuzzy.js),
// or every file find lists (20,000 at most, .git and node_modules left out) where there's no fd, for
// the caller to filter. Stops after `seconds` with what it found: a home folder can take minutes.
// Resolves { paths, fd, cut }.
const FIND = 's=$1; shift; if [ "$1" = find ]; then find . \\( -name .git -o -name node_modules \\) -prune -o -type f -print 2>/dev/null | head -n 20000 & '
  + 'else command -v "$1" >/dev/null 2>&1 || exit 127; "$@" & fi; p=$!; ( sleep "$s"; kill "$p" ) >/dev/null 2>&1 & w=$!; wait "$p"; c=$?; kill "$w" 2>/dev/null; exit $c';
const PHYSICAL = new Map(); // on + root -> the path fd matches against (pwd -P: /tmp is /private/tmp)
export async function findFiles(on, root, query, seconds = 5) {
  if (windowsHere(on)) throw new Error("Search needs sh, which Windows doesn't have");
  const caps = capsOf(on, await facts(on).catch(() => null));
  const run = args => sh(on, FIND, [String(seconds), ...args], { cwd: root, timeout: (seconds + 10) * 1000 });
  let r = null, fd = Boolean(caps.fd);
  if (fd) {
    const k = `${on ?? ""}\0${root}`;
    if (!PHYSICAL.has(k)) PHYSICAL.set(k, (await sh(on, 'cd "$1" && pwd -P', [root]).catch(() => null))?.stdout.trim() || root);
    const [first, ...more] = patterns(query, PHYSICAL.get(k));
    r = await run([caps.fd, "--type", "f", "--hidden", "--exclude", ".git", "--ignore-case", "--max-results", "400", "--full-path", "--print0", ...more.flatMap(p => ["--and", p]), "--", first]);
    if (r.code === 127) fd = false;
  }
  if (!fd) r = await run(["find"]);
  const cut = r.code === 143;
  if (r.code !== 0 && !cut) throw new Error(why(r.stderr, "Search failed"));
  // The last piece is empty, or cut short when the time ran out.
  const paths = r.stdout.split(fd ? "\0" : "\n");
  paths.pop();
  return { paths: paths.map(p => p.replace(/^\.\//, "")).filter(Boolean), fd, cut };
}

// ---- git

export const git = (on, cwd, args, timeout = 30000) => exec("git", args, { cwd, on: on ?? null, timeout });

// The repositories below cwd, down to `depth` folders (repos.js: one find, node_modules skipped, 20 at
// most), as folders relative to it. None on Windows here (no find).
export async function findRepos(on, cwd, depth) {
  if (depth < 1 || windowsHere(on)) return [];
  const r = await exec("find", findArgs(Math.min(depth, 10)), { cwd, on: on ?? null, timeout: 10000 }).catch(() => null);
  return reposOf(r?.stdout);
}

// ---- Images

// image() shows files from the app's folder only (up to 16 MiB), so an image is copied into
// cache/<this mod>/ there, named by where it is, its size and time: a changed file is a new copy. Here
// with cp; from another machine through exec as base64 (exec keeps 8 MiB of output, so up to 5 MiB).
// The 20 newest copies stay. Resolves the path for image().
export const IMAGE_LIMIT = 16 * 1024 * 1024, REMOTE_IMAGE = 5 * 1024 * 1024;
const cacheDir = () => `${appHome()}/cache/${ID}`;
const KEEP = 'mkdir -p "$1" && cd "$1" && { { [ -e "$3" ] && touch -- "$3"; } || { [ -n "$2" ] && cp -- "$2" "$3"; }; } && ls -t | tail -n +21 | while IFS= read -r f; do rm -f -- "$f"; done';
// sh -c FETCH sh <file> <max bytes>: its size on a line, then the file in base64. Exit 3: not a file;
// 4: larger than max (the size printed).
export const FETCH = '[ -f "$1" ] || exit 3; s=$(wc -c < "$1" | tr -d " "); [ "$s" -le "$2" ] || { echo "$s"; exit 4; }; echo "$s"; '
  + 'if command -v base64 >/dev/null 2>&1; then base64 < "$1"; else openssl base64 < "$1"; fi';
const mb = n => `${Math.round(n / 1048576)} MB`;
export async function imageFor(on, full) {
  const [st] = await info(on, [full]);
  if (!st || st.kind !== "f") throw new Error("This file is no longer available");
  const limit = on ? REMOTE_IMAGE : IMAGE_LIMIT;
  if (st.size > limit) throw new Error(`Too large to preview (${mb(st.size)})${on ? "" : " · double-click to open it"}`);
  const dot = full.lastIndexOf("."), ext = dot > full.lastIndexOf("/") ? full.slice(dot).toLowerCase() : "";
  const name = createHash("sha256").update(`${on ?? ""}\0${full}\0${st.size}\0${st.mtime}`).digest("hex").slice(0, 16) + ext;
  if (on && !(await fs.exists(`${cacheDir()}/${name}`).catch(() => false))) {
    const r = await sh(on, FETCH, [full, String(limit)], { timeout: 60000 });
    if (r.code === 4) throw new Error(`Too large to preview (${mb(Number(r.stdout))})`);
    if (r.code !== 0) throw new Error(why(r.stderr, "Couldn't read it from there"));
    const nl = r.stdout.indexOf("\n");
    await fs.mkdir(cacheDir(), { recursive: true });
    await fs.writeFile(`${cacheDir()}/${name}`, Buffer.from(r.stdout.slice(nl + 1).replace(/\s+/g, ""), "base64"));
  }
  await shOrSay(null, KEEP, [cacheDir(), on ? "" : full, name], "Couldn't copy it for the preview");
  return `cache/${ID}/${name}`;
}
