// Blame and a file at a revision (blame.js, fileat.js): a diff line's right-click → Blame line N
// (who last changed it and when, the commit shown, blame before that change, the hash copied), and
// History's file menu → Open this version (the file as that commit has it, a copy here opened by
// the system's opener). Nothing here reads a view: a flow gets `h`, a host (stashui.js), and its
// callbacks.
import * as fs from "fs/promises";
import { blameArgs, parseBlame, beforeOf } from "./blame.js";
import { showArgs, sizeArgs, MAX_SHOW, looksBinary } from "./fileat.js";
import { gitSays } from "./stashes.js";

const short = (s) => String(s ?? "").slice(0, 7);
function ago(sec, now = Date.now() / 1000) {
  const d = Math.max(0, now - sec), unit = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]].find(([s]) => d >= s);
  if (!unit) return "just now";
  const n = Math.floor(d / unit[0]);
  return `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
}

/** Blame line `line` of `path` (from the repository's top) at `rev` (null: the working tree): a
 *  menu says who, when and which commit; "Blame before this change" goes on to the version before
 *  it. `show(sha)` shows a commit, `copy(text, what)` copies. */
export async function blameFlow(h, { path, line, rev = null, show, copy }) {
  for (let hops = 0; hops < 50; hops++) {
    const r = await h.git(blameArgs(path, { rev, lines: [line, line] }));
    if (r.code !== 0) { h.note(`Blame failed: ${gitSays(r) || "git blame refused"}`); return; }
    const b = parseBlame(r.stdout), l = b.lines[0], c = l ? b.commits.get(l.sha) : null;
    if (!l || !c) { h.note(`git has no blame for line ${line}`); return; }
    const before = beforeOf(l, b);
    const title = c.uncommitted ? `Line ${line} · not committed yet` : `${short(c.sha)} · ${c.author} · ${ago(c.authorTime)}`;
    const items = [
      { id: "about", disabled: true, label: c.uncommitted ? "Changed in the working tree" : c.summary || "(no message)", detail: `${path}${rev ? ` at ${short(rev)}` : ""}, line ${line}${c.boundary ? " · where the history stops" : ""}` },
      ...(c.uncommitted ? [] : [{ id: "show", label: "Show the commit", detail: "In Changes, read-only" }]),
      { id: "before", label: "Blame before this change", disabled: !before, detail: before ? `${before.path} at ${short(before.rev)}, line ${before.line}` : "It came in with the first commit here" },
      ...(c.uncommitted ? [] : [{ id: "copy", label: "Copy the hash" }]),
    ];
    const pick = await h.choose({ title, width: 320, items });
    if (!pick || !h.same()) return;
    if (pick === "show") return show(c.sha);
    if (pick === "copy") return copy(c.sha, "the hash");
    ({ rev, path, line } = before);
  }
}

/** How many Open this version copies the cache folder keeps: the newest; older ones go. */
export const KEEP_VERSIONS = 20;
// A short, stable mark of a file's path (FNV-1a), so two files of one name at one commit (src/a/index.js,
// src/b/index.js) don't share a copy: the second would rewrite the first under an open editor.
const mark = (s) => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
/** A copy's name: at-<commit>-<the path's mark>-<the file's name, only letters, digits, ".", "_" and
 *  "-" kept> (its extension stays, so the editor knows the language). */
export const versionName = (rev, path) => `at-${short(rev)}-${mark(path)}-${(String(path).split("/").pop() || "file").replace(/[^A-Za-z0-9._-]/g, "_")}`;
/** The sh that keeps the newest KEEP_VERSIONS copies in folder "$1": only names versionName makes go
 *  (the folder also holds the diff's image copies, pruned on their own: images.js). */
export const PRUNE_VERSIONS_SH = 'dir=$1; case $dir in /?*) ;; *) echo "not a cache folder: $dir" >&2; exit 2;; esac; '
  + `cd -- "$dir" && ls -t | grep -E '^at-[0-9a-f]{4,}-[0-9a-f]{8}-[A-Za-z0-9._-]+$' | tail -n +${KEEP_VERSIONS + 1} | while IFS= read -r f; do rm -f -- "$f"; done; exit 0`;

/** Open this version: `path` as commit `rev` has it, written to `dir` here (versionName), the older
 *  copies pruned (`prune(dir)`, PRUNE_VERSIONS_SH: they piled up before), then opened with
 *  `open(file)`. A binary file or one over fileat.js MAX_SHOW isn't fetched. */
export async function openVersionFlow(h, { rev, path, dir, open, prune }) {
  const size = await h.git(sizeArgs(rev, path));
  if (size.code !== 0) { h.note(`${path} isn't in ${short(rev)}`); return; }
  if (Number(size.stdout.trim()) > MAX_SHOW) { h.note(`${path} is too large to open here (${Math.round(Number(size.stdout.trim()) / 1048576)} MB)`); return; }
  const r = await h.git(showArgs(rev, path));
  if (r.code !== 0) { h.note(`Couldn't read ${path}: ${gitSays(r)}`); return; }
  if (looksBinary(r.stdout)) { h.note(`${path} is binary: only text versions open from here`); return; }
  const file = `${dir}/${versionName(rev, path)}`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, r.stdout);
  await prune?.(dir);
  const failed = await open(file);
  if (failed) h.note(`Couldn't open it: ${failed}`);
}
