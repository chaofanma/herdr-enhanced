// The Changes page's scopes beyond the working tree's three (main.js: Uncommitted, Last commit,
// vs <base>): "A commit…" (a commit against its first parent), "Compare with…" (a branch, tag or
// commit against the working tree) and "An agent's turn…" (turns.js: its start snapshot against its
// end, or against the working tree while it runs), all read-only. A scope is remembered per
// repository as a string in the shared scope memory: "work", "last", "branch", "commit:<sha>",
// "ref:<name>", "turn:<id>".
// No Herdr imports: tested with node (test/git-enhanced/scopes.test.mjs).
import { turnScopeLabel, turnScopeWords } from "./turns.js";
import { ID, KEY } from "./id.js";

/** The shared scope memory (main.js SCOPE) and the request another page makes to show a scope. */
export const SCOPE_KEY = KEY.scope, SHOW = KEY.show;
/** Scopes that compare something with the working tree: they keep every action. */
export const WORKING = ["work", "last", "branch"];
/** Scopes that only look: no staging, no hunk buttons, no reverting files from the list. */
export const READ_ONLY = ["commit", "ref", "turn"];

export const readOnly = (scope) => READ_ONLY.includes(scope);
export const scopeId = (scope, target = null) => (target ? `${scope}:${target}` : scope);
/** A remembered scope: `{ scope, target }`, or null for nothing or junk. */
export function parseScope(id) {
  if (typeof id !== "string" || !id) return null;
  const i = id.indexOf(":"), scope = i < 0 ? id : id.slice(0, i), target = i < 0 ? null : id.slice(i + 1) || null;
  if (WORKING.includes(scope)) return { scope, target: null };
  if (READ_ONLY.includes(scope) && target) return { scope, target };
  return null;
}

/** What a read-only scope compares, from its resolved commit: `{ from, to }` for `git diff from
 *  [to]` (to null: the working tree). A commit is diffed against its first parent, a root
 *  commit against the empty tree; a turn's start against its end (`to`: a commit, or the working
 *  tree's tree now while it runs). */
export function readOnlyRange(scope, { sha, parent, empty, to }) {
  if (scope === "commit") return { from: parent || empty, to: sha };
  if (scope === "ref") return { from: sha, to: null };
  if (scope === "turn") return to ? { from: sha, to } : null;
  return null;
}

const short = (s) => (/^[0-9a-f]{12,64}$/.test(s ?? "") ? s.slice(0, 7) : s);
/** The header's name for a read-only scope ("Commit 1a2b3c4", "vs main", "Turn · pi 14:03"). */
export function readOnlyLabel(scope, target, span = null) {
  return scope === "commit" ? `Commit ${short(target)}` : scope === "ref" ? `vs ${short(target)}` : scope === "turn" ? turnScopeLabel(span?.turn) : "";
}
/** The scope in words, for a review sent to an agent. `span`: { sha, subject, root (a root commit) }. */
export function readOnlyWords(scope, target, span = {}) {
  const s = span.subject ? `, "${span.subject}"` : "";
  if (scope === "commit") return span.root ? `root commit ${short(target)}${s} (all of its files)` : `commit ${short(target)}${s} against its first parent`;
  if (scope === "ref") return `the working tree against ${short(target)}${span.sha && short(span.sha) !== short(target) ? ` (${span.sha.slice(0, 7)})` : ""}`;
  if (scope === "turn") return turnScopeWords(span.turn);
  return "";
}

/** `git log` lines for the picker's commits: `{ sha, short, subject, age }`. */
export const COMMITS = ["log", "-60", "--format=%H%x1f%h%x1f%s%x1f%cr", "HEAD", "--"];
export function parseCommits(stdout) {
  return String(stdout ?? "").split("\n").filter(Boolean).map((l) => { const [sha, s, subject, age] = l.split("\x1f"); return { sha, short: s, subject, age }; }).filter((c) => /^[0-9a-f]{7,64}$/.test(c.sha ?? ""));
}
/** `git for-each-ref` lines for the picker's refs: `{ name, kind, short, age }`, newest first. */
export const REFS = ["for-each-ref", "--sort=-committerdate", "--count=200", "--format=%(refname)%1f%(refname:short)%1f%(objectname:short)%1f%(committerdate:relative)", "refs/heads", "refs/remotes", "refs/tags"];
export function parseRefList(stdout) {
  return String(stdout ?? "").split("\n").filter(Boolean).map((l) => {
    const [full, name, s, age] = l.split("\x1f");
    const kind = full.startsWith("refs/heads/") ? "branch" : full.startsWith("refs/tags/") ? "tag" : "remote";
    return { name, kind, short: s, age, head: full.endsWith("/HEAD") };
  }).filter((r) => r.name && !(r.kind === "remote" && r.head)).map(({ head, ...r }) => r);
}
/** The picker's rows matching what is typed (any case, anywhere in the name, hash or subject). */
export function matching(items, text) {
  const q = String(text ?? "").trim().toLowerCase();
  if (!q) return items;
  return items.filter((x) => [x.name, x.sha, x.short, x.subject, x.title].some((v) => typeof v === "string" && v.toLowerCase().includes(q)));
}

/** In a layout tree, the stack and child that show a Changes page (this mod without a view, a role
 *  such as the panel's tab header, or a review): `{ stack, child }`, or null. */
export function changesPage(node, mod = ID) {
  for (const child of node?.children ?? []) {
    const p = child?.content?.props;
    if (node.type === "stack" && child?.content?.mod === mod && !p?.view && !p?.review && !p?.role) return { stack: node.id, child: child.id };
    const found = changesPage(child, mod);
    if (found) return found;
  }
  return null;
}
