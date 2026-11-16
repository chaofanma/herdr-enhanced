// Rewriting history from the History page: reword, squash into the parent, drop, and an interactive
// rebase from a commit (reorder, squash, fixup, drop, reword the commits above it), each one
// `git rebase -i` whose todo list and messages are ours: GIT_SEQUENCE_EDITOR copies our list over
// git's, GIT_EDITOR puts in the message we have for the commit being written (git's own combined
// message stays for a squash we have none for). The list and the messages travel as files
// (scripts.js FILES_SH), so it runs on another machine too. Also: which commits may be rewritten
// (on the current branch, not pushed unless the person says so, no merge in the way), a commit's
// web page (Open on GitHub) and a worktree made at a commit.
// No Herdr imports: tested with node (test/git-enhanced/rewrite.test.mjs).
import { fileOf } from "./scripts.js";

export const ACTIONS = ["pick", "reword", "squash", "fixup", "drop"];
/** The most commits a rewrite takes (CHAIN_SH lists up to this many). */
export const MOST = 500;
const SHA = /^[0-9a-f]{7,64}$/;

/** The todo list for `steps`, oldest first ([{ action, sha }]). */
export const todoOf = (steps) => steps.map((s) => `${s.action} ${s.sha}`).join("\n") + "\n";

/** Why a list of steps can't run, or null: a squash or fixup needs a commit before it that stays. */
export function stepsProblem(steps) {
  if (!steps.length) return "Nothing to rebase";
  for (const s of steps) if (!ACTIONS.includes(s.action) || !SHA.test(s.sha)) return `"${s.action} ${s.sha}" is no step`;
  const first = steps.find((s) => s.action !== "drop");
  if (!first) return "Every commit would be dropped: reset the branch instead";
  if (first.action === "squash" || first.action === "fixup") return "The first commit kept can't be squashed or fixed up: there is nothing before it to go into";
  return null;
}

/** Which step's message git asks for in a run of squashes and fixups: the last squash of each run
 *  (a run of fixups only keeps the first commit's message and asks nothing). Returns the shas
 *  whose message the person may write: rewords, and the last squash of each run. */
export function messageSteps(steps) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.action === "reword") out.push(s.sha);
    if (s.action === "squash" || s.action === "fixup") {
      let j = i;
      while (j + 1 < steps.length && (steps[j + 1].action === "squash" || steps[j + 1].action === "fixup")) j++;
      const run = steps.slice(i, j + 1), last = [...run].reverse().find((x) => x.action === "squash");
      if (last) out.push(last.sha);
      i = j;
    }
  }
  return out;
}

/** The message files: one per commit whose message we write, named by its hash. */
export const messageFiles = (messages) => Object.entries(messages ?? {})
  .filter(([sha, m]) => SHA.test(sha) && typeof m === "string" && m.trim())
  .map(([sha, m]) => ({ name: `msg-${sha}`, text: m.replace(/\s+$/, "") + "\n" }));

// GIT_EDITOR's script: the commit being written is the last line of the rebase's done list ("reword
// <sha> …" or "squash <sha> …"); a message of ours for that commit replaces what git opened.
export const EDITOR_SH = 'f=$1; done=$(git rev-parse --git-path rebase-merge/done 2>/dev/null) || exit 0; [ -f "$done" ] || exit 0; '
  + 'set -f; set -- $(tail -n 1 "$done"); [ -n "$2" ] || exit 0; full=$(git rev-parse -q --verify "$2^{commit}" 2>/dev/null) || exit 0; '
  + '[ -f "$PC_DIR/msg-$full" ] && cp "$PC_DIR/msg-$full" "$f"; exit 0';

/** The body of a FILES_SH script that runs the rebase: "$d/todo" our list, "$d/msg-<sha>" the
 *  messages, "$d/editor" EDITOR_SH; "$1" the base (a commit, or "--root"). Prints "done", or
 *  "stopped" and git's words when it stopped (a conflict) and the rebase waits; exit 1 with git's
 *  words when git refused to start. */
export const REBASE_BODY = 'base=$1; PC_DIR=$d; export PC_DIR; '
  + "GIT_SEQUENCE_EDITOR='cp \"$PC_DIR/todo\"'; GIT_EDITOR='sh \"$PC_DIR/editor\"'; export GIT_SEQUENCE_EDITOR GIT_EDITOR; "
  + 'if [ "$base" = --root ]; then set -- --root; else set -- "$base"; fi; '
  + 'out=$(git -c rebase.autoSquash=false -c rebase.missingCommitsCheck=ignore -c rebase.updateRefs=false rebase -i --empty=drop "$@" 2>&1); c=$?; '
  + 'g=$(git rev-parse --git-dir); if [ $c = 0 ]; then echo done; elif [ -d "$g/rebase-merge" ] || [ -d "$g/rebase-apply" ]; then echo stopped; printf "%s\\n" "$out"; else printf "%s\\n" "$out" >&2; exit 1; fi';

/** The files REBASE_BODY reads: the todo, the messages, the editor script. */
export const rebaseFiles = (steps, messages) => [{ name: "todo", text: todoOf(steps) }, ...messageFiles(messages), { name: "editor", text: EDITOR_SH + "\n" }];

/** What a rebase reported: { stopped: git's words } or { stopped: null }; a refusal throws. */
export function rebaseResult({ code, stdout = "", stderr = "" }) {
  if (code !== 0) throw new Error(words(stderr || stdout) || "git rebase failed");
  const [first, ...rest] = String(stdout).split("\n");
  return first.trim() === "stopped" ? { stopped: words(rest.join("\n")) || "The rebase stopped" } : { stopped: null };
}
const words = (text) => String(text ?? "").split(/\r\n|\r|\n/).map((l) => l.trim())
  .filter((l) => l && !/^hint:/.test(l) && !/^(Successfully rebased|Rebasing \(|Executing:)/.test(l)).slice(0, 6).join("\n");

/** sh's script that tells what rewriting from commit "$1" takes ("$2": the most commits listed).
 *  First line: its parent and grandparent ("-": none), whether the parent is a merge ("merge" or
 *  "one"), whether the commit is on HEAD ("on"/"off"), pushed ("pushed": a remote branch has it, or
 *  "local"), and how many commits a rebase from it replays (it and every one after it on HEAD).
 *  Then, when that many fit, those commits oldest first: "<sha> <parents…>" a line. */
export const CHAIN_SH = 'c=$1; most=$2; p=$(git rev-parse -q --verify "$c^1^{commit}" 2>/dev/null) || p=-; g=-; pm=one; '
  + 'if [ "$p" != - ]; then g=$(git rev-parse -q --verify "$p^1^{commit}" 2>/dev/null) || g=-; git rev-parse -q --verify "$p^2" >/dev/null 2>&1 && pm=merge; fi; '
  + 'if git merge-base --is-ancestor "$c" HEAD 2>/dev/null; then on=on; else on=off; fi; '
  + 'if [ -n "$(git branch -r --contains "$c" 2>/dev/null | head -n 1)" ]; then pushed=pushed; else pushed=local; fi; '
  + 'n=0; [ $on = on ] && n=$(git rev-list --count HEAD --not "$c^@" 2>/dev/null); '
  + 'printf "%s %s %s %s %s %s\\n" "$p" "$g" "$pm" "$on" "$pushed" "${n:-0}"; '
  + '[ $on = on ] && [ "${n:-0}" -le "$most" ] && git rev-list --reverse --parents HEAD --not "$c^@"; exit 0';

/** CHAIN_SH's output: { parent, grand, parentMerges, onHead, pushed, count, chain: [{ sha, parents }] }. */
export function parseChain(stdout) {
  const lines = String(stdout ?? "").split("\n").filter(Boolean);
  const [p = "-", g = "-", pm = "one", on = "off", pushed = "local", n = "0"] = (lines[0] ?? "").split(" ");
  const seen = new Set(), chain = [];
  for (const l of lines.slice(1)) {
    const [sha, ...parents] = l.trim().split(" ");
    if (!SHA.test(sha) || seen.has(sha)) continue;
    seen.add(sha); chain.push({ sha, parents });
  }
  return { parent: p === "-" ? null : p, grand: g === "-" ? null : g, parentMerges: pm === "merge", onHead: on === "on", pushed: pushed === "pushed", count: Number(n) || 0, chain };
}

/** Whether commit `sha` may be rewritten, from its chain (parseChain): null, or why not. A pushed
 *  one only when `pushedOk` (the person ticked that they know). */
export function rewriteBlock(ch, { sha, action = "reword", pushedOk = false } = {}) {
  if (!ch.onHead) return "Only commits on the current branch can be rewritten";
  if (ch.count > MOST || ch.chain.length !== ch.count) return `More than ${MOST} commits after it: rewrite it in a terminal`;
  if (ch.chain.some((c) => c.parents.length > 1)) return "There is a merge between this commit and HEAD: rewrite it in a terminal (git rebase --rebase-merges)";
  if (action === "squash" && !ch.parent) return "The first commit has no parent to squash into";
  if (action === "squash" && ch.parentMerges) return "Its parent is a merge: squashing into it isn't done here";
  if (ch.chain[0] && ch.chain[0].sha !== sha && !ch.chain[0].sha.startsWith(sha)) return "This commit isn't where its history starts";
  if (ch.pushed && !pushedOk) return "Already pushed: rewriting it changes history others may have";
  return null;
}

/** The plan for one commit's rewrite from its chain: { base, steps, messages }.
 *  - reword: the commit's message becomes `message`;
 *  - squash: the commit goes into its parent with `message` (null: git's combined one);
 *  - fixup: into its parent, keeping the parent's message;
 *  - drop: it goes. */
export function planFor(action, ch, { message = null } = {}) {
  const [first, ...above] = ch.chain, rest = above.map((c) => ({ action: "pick", sha: c.sha }));
  const base = ch.parent ?? "--root";
  if (action === "reword") return { base, steps: [{ action: "reword", sha: first.sha }, ...rest], messages: { [first.sha]: message } };
  if (action === "drop") return { base, steps: [{ action: "drop", sha: first.sha }, ...rest], messages: {} };
  if (action === "squash" || action === "fixup") {
    return { base: ch.grand ?? "--root", steps: [{ action: "pick", sha: ch.parent }, { action, sha: first.sha }, ...rest], messages: action === "squash" && message ? { [first.sha]: message } : {} };
  }
  throw new Error(`no rewrite ${action}`);
}

/** The interactive rebase's plan from the editor's rows ([{ sha, action }], oldest first) and the
 *  messages written there ({ sha: text }): only the messages git will ask for. */
export function editorPlan(ch, rows, messages = {}) {
  const steps = rows.map((r) => ({ action: r.action, sha: r.sha }));
  const asked = new Set(messageSteps(steps));
  return { base: ch.parent ?? "--root", steps, messages: Object.fromEntries(Object.entries(messages).filter(([sha, m]) => asked.has(sha) && m?.trim())) };
}

/** A commit's page on the web from a remote's URL (GitHub, GitLab, Bitbucket, or a host like them;
 *  ssh or https), or null. */
export function webUrl(remoteUrl, sha) {
  const u = String(remoteUrl ?? "").trim();
  const m = /^https?:\/\//.test(u) ? /^https?:\/\/(?:[^@/\s]+@)?([^/\s:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(u)
    : /^(?:ssh:\/\/)?(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(u);
  if (!m || !SHA.test(String(sha))) return null;
  const host = m[1].replace(/^ssh\./, ""), path = m[2];
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(path) || path.split("/").includes("..") || /^\d+$/.test(path.split("/")[0])) return null;
  const page = /bitbucket/i.test(host) ? "commits" : /gitlab/i.test(host) ? "-/commit" : "commit";
  return `https://${host}/${path}/${page}/${sha}`;
}
/** The site's name for a menu row ("GitHub", "GitLab", "Bitbucket", else the host). */
export function siteOf(url) {
  const host = /^https:\/\/([^/]+)\//.exec(String(url ?? ""))?.[1] ?? "";
  return /github/i.test(host) ? "GitHub" : /gitlab/i.test(host) ? "GitLab" : /bitbucket/i.test(host) ? "Bitbucket" : host || "the web";
}

/** Where Herdr's worktree dialog puts a branch's checkout: <base>/<repository>/<branch, anything
 *  but letters, digits, ".", "_" and "-" as one "-">. The same rule as its slug(). */
export const slugOf = (branch) => String(branch).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

/** sh's script that makes a worktree with a new branch "$1" at commit "$2" where Herdr's worktree
 *  dialog keeps them ("$3", else ~/.herdr/worktrees, on the repository's machine), in
 *  <repository>/<slugOf(branch)>. Prints its folder; exit 1 with git's words when it can't. */
export const WORKTREE_SH = 'b=$1 c=$2 base=${3:-$HOME/.herdr/worktrees}; top=$(git rev-parse --show-toplevel) || exit 1; '
  + 'common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=$(git rev-parse --git-common-dir) || exit 1; '
  + 'case $common in /*) ;; *) common="$top/$common";; esac; case $common in */.git) main=${common%/.git};; *) main=$common;; esac; repo=$(basename "$main"); '
  + 'slug=$(printf "%s" "$b" | tr -cs "A-Za-z0-9._-" "-" | sed "s/^-*//; s/-*$//"); p="$base/$repo/$slug"; '
  + '[ -e "$p" ] && { echo "$p already exists" >&2; exit 1; }; mkdir -p "$base/$repo" || exit 1; '
  + 'git worktree add -q -b "$b" "$p" "$c" >&2 || exit 1; printf "%s\\n" "$p"';

// ---- With a runner (gitops.js runnerOf: git, sh, files there)

/** What rewriting from `sha` takes (parseChain). */
export async function chainOf(h, sha) {
  const r = await h.sh(CHAIN_SH, [sha, String(MOST)]);
  if (r.code !== 0) throw new Error(words(r.stderr) || "git can't read this commit's history");
  return parseChain(r.stdout);
}

/** Runs a plan ({ base, steps, messages }) as one interactive rebase: { stopped } (rebaseResult). */
export async function runPlan(h, plan) {
  const problem = stepsProblem(plan.steps);
  if (problem) throw new Error(problem);
  const r = await h.files(rebaseFiles(plan.steps, plan.messages).map((f) => fileOf(f.name, f.text)), REBASE_BODY, [plan.base], { timeout: 180000 });
  return rebaseResult(r);
}
