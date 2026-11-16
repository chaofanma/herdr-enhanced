// The History page's git log (history.js): the command for one page of commits, reading its
// output, the ref names git decorates commits with, the search box's words, a commit's details
// and changed files, and times for people. One `git log` per page asks for one commit more than it
// shows (so it knows there is a next page) and takes the refs from git's own decorations (%D); its
// records are NUL separated (-z), so no subject can break one.
// No Herdr imports: tested with node (test/git-enhanced/gitlog.test.mjs).
import { REFS } from "./id.js";

/** Commits per page ("Load more" asks for the next). */
export const PAGE = 300;
/** The log's fields, NUL separated: hash, parents, author, email, author time, refs, subject. */
export const FIELDS = ["%H", "%P", "%an", "%ae", "%at", "%D", "%s"];
const FORMAT = FIELDS.join("%x00");
/** No signature checks, colors, mailmap surprises or our own refs (turn snapshots) in the output. */
const BASE = ["-c", "log.showSignature=false", "-c", "color.ui=false", "log", `--format=${FORMAT}`, "-z", "--decorate=full", `--decorate-refs-exclude=${REFS.slice(0, -1)}`, "--decorate-refs-exclude=refs/stash"];

/** The refs a page starts from: one branch (the search's branch:), every branch, remote branch and
 *  tag, or HEAD and its upstream. */
export function startRefs({ all = false, upstream = null, branch = null } = {}) {
  if (branch) return [branch];
  return all ? ["--branches", "--remotes", "--tags", "HEAD"] : upstream ? ["HEAD", upstream] : ["HEAD"];
}

/** git's arguments for a page of commits: `count` of them (one more than shown tells there is a
 *  next page) after `skip`, topologically ordered, from `refs`, filtered by a search (parseQuery).
 *  A search for one file follows its renames. */
export function logArgs({ refs = ["HEAD"], skip = 0, count = PAGE + 1, search = null, follow = false } = {}) {
  const s = search ?? {}, filters = [];
  if (s.grep || s.author) filters.push("--regexp-ignore-case", "--fixed-strings");
  if (s.grep) filters.push(`--grep=${s.grep}`);
  if (s.author) filters.push(`--author=${s.author}`);
  if (follow && s.path) filters.push("--follow");
  return [...BASE, "--topo-order", `--max-count=${count}`, ...(skip ? [`--skip=${skip}`] : []), ...filters, ...refs, "--", ...(s.path ? [s.path] : [])];
}

/** One commit's line, as `logArgs` asks for it, from a hash or ref (a SHA search). */
export const oneArgs = (rev) => [...BASE, "--no-walk", rev, "--"];

/** The commits in a log's output: `{ hash, parents, author, email, time, refs, subject }`. */
export function parseLog(stdout) {
  const parts = String(stdout ?? "").split("\0"), n = FIELDS.length, out = [];
  if (parts.at(-1) === "") parts.pop();
  for (let i = 0; i + n <= parts.length; i += n) {
    const [hash, parents, author, email, time, refs, subject] = parts.slice(i, i + n);
    // A record starts with a hash; anything else (a stray newline) is skipped up to the next.
    const h = hash.replace(/^\n/, "");
    if (!/^[0-9a-f]{7,64}$/.test(h)) continue;
    out.push({ hash: h, parents: parents ? parents.split(" ") : [], author, email, time: Number(time) || 0, refs: parseRefs(refs), subject });
  }
  return out;
}

/** The refs in a `%D` decoration with `--decorate=full`: `HEAD -> refs/heads/main, refs/remotes/
 *  origin/main, tag: refs/tags/v1, HEAD` → `{ kind: "head" | "branch" | "remote" | "tag", name,
 *  current }` (current: the branch HEAD is on; a detached HEAD is its own "head" ref). */
export function parseRefs(decoration) {
  const out = [];
  for (let part of String(decoration ?? "").split(", ")) {
    part = part.trim();
    if (!part) continue;
    let current = false;
    if (part.startsWith("HEAD -> ")) { current = true; part = part.slice(8); }
    else if (part === "HEAD") { out.push({ kind: "head", name: "HEAD", current: true }); continue; }
    if (part.startsWith("tag: ")) part = part.slice(5);
    if (part.startsWith("refs/heads/")) out.push({ kind: "branch", name: part.slice(11), current });
    else if (part.startsWith("refs/remotes/")) { if (!part.endsWith("/HEAD")) out.push({ kind: "remote", name: part.slice(13), current: false }); }
    else if (part.startsWith("refs/tags/")) out.push({ kind: "tag", name: part.slice(10), current: false });
  }
  // The current branch first, then branches, remotes, tags.
  const order = { head: 0, branch: 1, remote: 2, tag: 3 };
  return out.sort((a, b) => Number(b.current) - Number(a.current) || order[a.kind] - order[b.kind]);
}

/** The search box: plain words are looked for in messages (any case) and, when they look like
 *  one, as a commit's hash prefix; `author:name` and `path:a/b` narrow it ("…" for spaces). */
export function parseQuery(text) {
  const out = { grep: null, author: null, path: null, sha: null, branch: null }, words = [];
  const re = /(author|path|branch):(?:"([^"]*)"|(\S*))|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(text ?? "")))) {
    if (m[1]) {
      const v = (m[2] ?? m[3] ?? "").trim();
      // A branch goes to git log as a revision: never one that reads as an option.
      if (v && !(m[1] === "branch" && v.startsWith("-"))) out[m[1]] = m[1] === "path" ? v.replace(/^\.\//, "").replace(/\/+$/, "") || "." : v;
    }
    else words.push(m[4] ?? m[5]);
  }
  const grep = words.join(" ").trim();
  if (grep) out.grep = grep;
  if (grep && /^[0-9a-f]{4,64}$/i.test(grep)) out.sha = grep.toLowerCase();
  return out;
}

/** Whether a search narrows the log (its lanes would not connect, so none are drawn). */
export const filtered = (s) => Boolean(s && (s.grep || s.author || s.path));

/** `git diff --name-status -z` (no renames): `[{ status: "A" | "M" | "D" | "T" | …, path }]`. */
export function parseNameStatus(stdout) {
  const parts = String(stdout ?? "").split("\0"), out = [];
  for (let i = 0; i + 1 < parts.length && parts[i]; i += 2) out.push({ status: parts[i][0], path: parts[i + 1] });
  return out;
}

/** `git diff --numstat -z` (no renames): Map(path → { add, del, binary }). */
export function parseNumstat(stdout) {
  const out = new Map();
  for (const entry of String(stdout ?? "").split("\0")) {
    const [a, d, ...rest] = entry.split("\t");
    if (!rest.length) continue;
    out.set(rest.join("\t"), { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" });
  }
  return out;
}

/** A commit's details, for `git show -s --format=` DETAILS: hash, parents, author and committer
 *  with their times, refs, and the whole message. */
export const DETAILS = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%D", "%B"].join("%x00");
export const detailArgs = (hash) => ["-c", "log.showSignature=false", "show", "-s", "--decorate=full", `--decorate-refs-exclude=${REFS.slice(0, -1)}`, `--format=${DETAILS}`, hash, "--"];
export function parseDetails(stdout) {
  const p = String(stdout ?? "").split("\0");
  if (p.length < 10 || !/^[0-9a-f]{7,64}$/.test(p[0])) return null;
  return {
    hash: p[0], parents: p[1] ? p[1].split(" ") : [], author: p[2], email: p[3], authorTime: Number(p[4]) || 0,
    committer: p[5], committerEmail: p[6], commitTime: Number(p[7]) || 0, refs: parseRefs(p[8]),
    message: p.slice(9).join("\0").replace(/\s+$/, ""),
  };
}

/** How long ago `time` (unix seconds) was, short: "now", "5 min", "3 h", "2 d", "4 w", "5 mo", "2 y". */
export function ago(time, now = Date.now() / 1000) {
  // Rounded and cut over as git's relative dates are ("2 days ago" for 45 hours, hours up to 36),
  // so a commit's age here agrees with the ages git prints elsewhere on the page (the branch list);
  // the words short.
  const div = (a, b) => Math.floor(a / b);
  let d = Math.max(0, Math.floor(now - time));
  if (d < 90) return "now";
  d = div(d + 30, 60);                      // minutes
  if (d < 90) return `${d} min`;
  d = div(d + 30, 60);                      // hours
  if (d < 36) return `${d} h`;
  d = div(d + 12, 24);                      // days
  if (d < 14) return `${d} d`;
  if (d < 70) return `${div(d + 3, 7)} w`;
  if (d < 365) return `${div(d + 15, 30)} mo`;
  if (d < 1825) return `${div(div(d * 24 + 365, 730), 12)} y`;
  return `${div(d + 183, 365)} y`;
}

/** A date and time for people, in the local zone: "2025-01-31 14:03". */
export function when(time) {
  const d = new Date(time * 1000), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The rev-list output of hashes (one per line) as a Set. */
export const hashSet = (stdout) => new Set(String(stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean));

/** A signature of where the refs point (`git for-each-ref` and HEAD): the page loads again when
 *  it changes. */
export const signature = (refs, head) => `${String(head ?? "").trim()}|${String(refs ?? "").trim()}`;

/** git's arguments for the commit menu's actions on `sha` (a merge is picked or reverted against
 *  its first parent). `name`: the new branch or tag; `mode`: soft, mixed or hard. */
export function actionArgs(action, { sha, name, mode, merge = false }) {
  switch (action) {
    case "branch": return ["branch", name, sha];
    case "tag": return ["tag", name, sha];
    case "checkout": return ["switch", "--detach", sha];
    case "cherry-pick": return ["cherry-pick", ...(merge ? ["-m", "1"] : []), sha];
    case "revert": return ["revert", "--no-edit", ...(merge ? ["-m", "1"] : []), sha];
    case "reset": return ["reset", `--${["soft", "mixed", "hard"].includes(mode) ? mode : "mixed"}`, sha];
    default: throw new Error(`no action ${action}`);
  }
}

/** git's arguments that tell a name is usable: a new branch's, or a tag's (one starting with a
 *  dash would read as an option, so it never is). */
export const nameArgs = (action, name) => (String(name).startsWith("-") ? ["check-ref-format", "--branch", "-"] : action === "tag" ? ["check-ref-format", `refs/tags/${name}`] : ["check-ref-format", "--branch", name]);

/** git's message without its "hint:" lines (what to type next, which the dialog says itself). */
export const brief = (text) => String(text ?? "").split("\n").filter((l) => !l.startsWith("hint:")).join("\n").trim();

/** How many entries `git status --porcelain=v1 -z --no-renames` printed. */
export const statusCount = (stdout) => String(stdout ?? "").split("\0").filter(Boolean).length;
/** How many of them are staged (their index column is a change: not " " and not "?"). */
export const stagedCount = (stdout) => String(stdout ?? "").split("\0").filter((e) => e.length > 3 && e[0] !== " " && e[0] !== "?").length;
