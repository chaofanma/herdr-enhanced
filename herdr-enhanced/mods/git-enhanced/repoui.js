// The History page's ⋯ menu (worktrees.js, remoteops.js, reflog.js, pullsync.js): Worktrees… (open
// one as a space, lock, unlock, move, remove; forget the missing ones; clean up the merged ones),
// Remotes… (each remote's menu, add one), Reflog… (an entry restored as a branch, by moving the
// branch, or detached), fetching every remote, and pruning one remote's tags. Nothing here reads
// the view: a flow gets `h`, a host (stashui.js), and its facts.
import * as W from "./worktrees.js";
import { removeFacts, removeNow, ignoredOf } from "./wtremove.js";
import * as R from "./remoteops.js";
import * as L from "./reflog.js";
import { fetchPlan } from "./pullsync.js";
import { atLeast, has, plan, step } from "./gitplan.js";
import { carryOut, readPlan } from "./planflow.js";
import { validBranchName } from "./gitops.js";
import { startFlow as bisectStart } from "./bisectui.js";

const short = (s) => String(s ?? "").slice(0, 7);
/** The most rows a list menu here holds (each 42 px with its second line: 12 fit the 640 px a menu
 *  may take, with the title and the last items); longer lists are a dialog that scrolls. */
export const MENU_MOST = 12;
const off = (why) => (why ? { disabled: true, detail: why } : {});
const ago = (sec, now = Date.now() / 1000) => {
  const d = Math.max(0, now - sec);
  return d < 90 ? "just now" : d < 5400 ? `${Math.round(d / 60)} min ago` : d < 129600 ? `${Math.round(d / 3600)} h ago` : `${Math.round(d / 86400)} days ago`;
};

/** The ⋯ menu's items for git `version` (worktrees need 2.7's list; pruning tags 2.17). */
export function moreItems({ version, remote, selected = null, bisecting = false, operation = null }) {
  const wt = atLeast(version, "2.7") ? null : version ? "Worktrees need git 2.7 or newer" : "Finding git's version…";
  const tags = !remote ? "No remote" : has(version, "prune-tags") ? null : "Pruning tags needs git 2.17 or newer";
  return [
    { id: "worktrees", label: "Worktrees…", ...off(wt) },
    { id: "remotes", label: "Remotes…" },
    { id: "reflog", label: "Reflog…", detail: "Everywhere HEAD has been" },
    { id: "fetch-all", label: "Fetch every remote", detail: "Remote branches gone there are pruned" },
    { id: "bisect", label: selected ? `Bisect: ${short(selected.hash)} is bad…` : "Bisect…", detail: "git finds the first bad commit with you",
      ...off(bisecting ? "A bisect is running: its bar has Reset" : operation ? `Not while a ${operation} is in progress` : !selected ? "Select the commit that has the bug first" : null) },
    { id: "prune-tags", label: remote ? `Fetch ${remote} and prune tags…` : "Fetch and prune tags…", danger: true, ...off(tags) },
  ];
}

/** The ⋯ menu and what was picked. `facts`: { branch, head, base, remote, top }; `open(folder)`
 *  opens a worktree as a space; `copy(text, what)` puts text on the clipboard. */
export async function moreFlow(h, { facts: given, version, open, copy, spaces = null }) {
  const facts = { ...given, ...(await placeFacts(h, given)) };
  const pick = await h.choose({ title: "History", width: 300, items: moreItems({ version, remote: facts.remote, selected: facts.selected, bisecting: facts.bisecting, operation: facts.operation }) });
  if (!pick || !h.same()) return;
  if (pick === "worktrees") return worktreesFlow(h, { facts, version, open, spaces });
  if (pick === "remotes") return remotesFlow(h, { copy });
  if (pick === "reflog") return reflogFlow(h, { facts, version, copy });
  if (pick === "bisect") {
    const tag = await h.git(["describe", "--tags", "--abbrev=0", `${facts.selected.hash}^`]);
    return bisectStart(h, { bad: facts.selected, guess: tag.code === 0 ? tag.stdout.trim() : "", version });
  }
  if (pick === "fetch-all") return carryOut(h, fetchPlan({ all: true }), { kind: "fetch" });
  return carryOut(h, fetchPlan({ remote: facts.remote, pruneTags: true, version }), { kind: "fetch", yes: "Fetch and prune" });
}

// The remote the page's upstream is on (else origin, else the first), and the base branch (the
// remote's default branch, else main, else master).
async function placeFacts(h, { upstream = null }) {
  const [names, head] = await readPlan(h, plan([step(["remote"], "Remotes"), step(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], "Base", { ok: [1, 128] })])).catch(() => ["", ""]);
  const remotes = names.split("\n").filter(Boolean), up = upstream ? remotes.filter((r) => upstream.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0] : null;
  let base = head.trim() || null;
  for (const b of ["main", "master"]) if (!base && (await h.git(["rev-parse", "-q", "--verify", `refs/heads/${b}`])).code === 0) base = b;
  return { remote: up ?? (remotes.includes("origin") ? "origin" : remotes[0] ?? null), base };
}

// ---- Worktrees

const wtLabel = (w) => (w.bare ? "(bare)" : w.branch ?? `detached at ${short(w.head)}`);
const wtDetail = (w) => [w.path, w.main && "main", w.locked && `locked${w.lockReason ? `: ${w.lockReason}` : ""}`, w.prunable && "folder gone"].filter(Boolean).join(" · ");

/** Worktrees…: the list (each one's menu), forget the missing ones, clean up the merged ones. */
export async function worktreesFlow(h, { facts, version, open, spaces = null }) {
  const [out] = await readPlan(h, plan([step(W.listArgs(version), "Worktrees")]));
  const list = W.parseWorktrees(out, { z: W.listZ(version) }), current = W.currentOf(list, facts.top);
  const pruneWhy = list.some((w) => w.prunable && !w.locked) ? null : has(version, "worktree-prunable") ? "Every worktree's folder is there" : null;
  const cleanWhy = facts.base ? null : "No base branch to be merged into";
  const label = (w) => `${wtLabel(w)}${w === current ? " (this one)" : ""}`;
  let pick;
  // A menu holds MENU_MOST of them; more go into a dialog that scrolls (a menu taller than the
  // screen would cut its last rows off).
  if (list.length <= MENU_MOST) {
    pick = await h.choose({ title: `Worktrees · ${list.length}`, width: 340, items: [
      ...list.map((w, i) => ({ id: `wt-${i}`, label: label(w), detail: wtDetail(w) })),
      { id: "prune", label: "Forget the missing ones…", ...off(pruneWhy) },
      { id: "cleanup", label: "Clean up merged worktrees…", ...off(cleanWhy) },
    ] });
  } else {
    const a = await h.ask({ title: `Worktrees · ${list.length}`, confirm: null, width: 520, height: 560, entries: [
      ...list.map((w, i) => ({ id: `wt-${i}`, title: label(w), detail: wtDetail(w), button: "⋯" })),
      { id: "prune", title: "Forget the missing ones…", detail: pruneWhy ?? "Worktrees whose folders are gone", button: "Forget…" },
      { id: "cleanup", title: "Clean up merged worktrees…", detail: cleanWhy ?? `Merged into ${facts.base}`, button: "Clean up…" },
    ] });
    pick = a?.choice ?? null;
    if (pick === "prune" && pruneWhy) { h.note(pruneWhy); return; }
    if (pick === "cleanup" && cleanWhy) { h.note(cleanWhy); return; }
  }
  if (!pick || !h.same()) return;
  if (pick === "prune") return carryOut(h, W.prunePlan(list), { kind: "worktree", yes: "Forget them" });
  if (pick === "cleanup") return worktreeCleanup(h, { list, base: facts.base, current: current?.path ?? null });
  const w = list[Number(pick.slice(3))];
  if (w) return worktreeFlow(h, w, { version, open, current: w === current, list, spaces });
}

async function worktreeFlow(h, w, { version, open, current, list = [], spaces = null }) {
  const moves = has(version, "worktree-move");
  const pick = await h.choose({ title: wtLabel(w), width: 320, items: [
    { id: "open", label: "Open as a space", ...off(w.bare ? "A bare repository has no files" : w.prunable ? "Its folder is gone" : current ? "This is the one shown" : null) },
    w.locked ? { id: "unlock", label: "Unlock" } : { id: "lock", label: "Lock…", detail: "Prune and remove leave it alone", ...off(w.main ? "The main worktree is never pruned" : null) },
    { id: "move", label: "Move…", ...off(w.main ? "The main worktree can't be moved" : !moves ? "Moving needs git 2.17 or newer" : w.locked ? "Unlock it first" : null) },
    { id: "remove", label: "Remove…", danger: true, ...off(w.main ? "The main worktree can't be removed" : !moves ? "Removing needs git 2.17 or newer" : current ? "This is the one shown" : null) },
  ] });
  if (!pick || !h.same()) return;
  if (pick === "open") return open(w.path);
  if (pick === "unlock") return carryOut(h, W.unlockPlan(w.path), { kind: "worktree" });
  if (pick === "lock") {
    const a = await h.ask({ title: `Lock the worktree at ${w.path}`, confirm: "Lock", input: { value: "", placeholder: "Why (optional): on a disk that comes and goes…" } });
    if (!a || !h.same()) return;
    return carryOut(h, W.lockPlan(w.path, a.text?.trim() || null), { kind: "worktree" });
  }
  if (pick === "move") {
    const a = await h.ask({ title: `Move the worktree at ${w.path}`, confirm: "Move", input: { value: w.path, placeholder: "The new folder", required: true } });
    if (!a || !h.same()) return;
    return carryOut(h, W.movePlan(w, a.text.trim()), { kind: "worktree" });
  }
  // Remove (wtremove.js): what goes is read first and named in one question (its changes make it
  // forced, its ignored files, the space in it); the space closes once it is answered.
  const facts = await removeFacts(h, w, { list, spaces });
  if (!(await h.ask(W.removeAsk(w, facts))) || !h.same()) return;
  h.act("worktree", () => removeNow(h, w, facts, spaces));
}

// Clean up merged worktrees: a ticked list; one with no commits of its own yet, or detached, starts
// unticked; one with ignored files isn't offered (they'd go with it).
async function worktreeCleanup(h, { list, base, current }) {
  const [merged, tip] = await readPlan(h, plan([{ script: W.MERGED_SH, args: W.mergedArgs(list, base), why: "Which are merged" },
    step(["rev-parse", "-q", "--verify", `${base}^{commit}`], "The base's tip", { ok: [1] })]));
  const ready = W.mergedWorktrees(list, merged, { current });
  if (!ready.length) { h.note(`No worktree to clean up: none is merged into ${base}`); return; }
  const ignored = new Map();
  for (const w of ready) ignored.set(w.path, await ignoredOf(h, w.path));
  const choices = W.cleanupChoices(ready, { baseHead: tip.trim() || null, ignored }), offered = choices.filter((c) => !c.ignored.length);
  const held = choices.filter((c) => c.ignored.length).map((c) => `${wtLabel(c.w)} (${W.namesOf(c.ignored, 2)})`);
  const heldWords = held.length ? ` Kept, as their ignored files would go with them: ${held.join(", ")}.` : "";
  if (!offered.length) { h.note(`No worktree to clean up.${heldWords}`); return; }
  const a = await h.ask({ title: "Clean up merged worktrees", confirm: "Remove", danger: true, width: 520,
    detail: `Merged into ${base}. Ticked ones go with their folders, and their branches unless they have unmerged commits; one with uncommitted changes is kept.${heldWords}`,
    files: { items: offered.map((c) => ({ path: c.w.path, label: `${wtLabel(c.w)}${c.note ? ` (${c.note})` : ""} · ${c.w.path}`, checked: c.checked })) } });
  if (!a || !h.same()) return;
  const chosen = offered.filter((c) => a.files.includes(c.w.path)).map((c) => c.w);
  return carryOut(h, W.cleanupPlan(chosen), { kind: "worktree", asked: true, after: (r) => {
    const out = W.parseCleanup(r.outputs[0]);
    const kept = out.filter((x) => x.status === "kept" || x.status === "branch-kept").map((x) => x.path);
    const late = out.filter((x) => x.status === "ignored").map((x) => x.path);
    const words = [kept.length && `Kept (changes, or commits not merged): ${kept.join(", ")}`, late.length && `Kept, as they now hold ignored files: ${late.join(", ")}`].filter(Boolean);
    if (words.length) h.note(words.join(". "));
  } });
}

// ---- Remotes

/** Remotes…: each remote (its menu), and Add a remote…. */
export async function remotesFlow(h, { copy }) {
  const [out, pd] = await readPlan(h, plan([step(R.REMOTES_ARGS, "Remotes"), step(R.PUSH_DEFAULT_ARGS, "Push default", { ok: [1] })]));
  const remotes = R.parseRemotes(out), pushDefault = R.parsePushDefault(pd);
  const label = (r) => `${r.name}${pushDefault === r.name ? " (pushes go here)" : ""}`;
  let pick;
  if (remotes.length <= MENU_MOST) {
    pick = await h.choose({ title: `Remotes · ${remotes.length}`, width: 340, items: [
      ...remotes.map((r, i) => ({ id: `r-${i}`, label: label(r), detail: r.fetch ?? "no URL" })),
      { id: "add", label: "Add a remote…" },
    ] });
  } else {
    // Past a menu's room: a dialog that scrolls, Add a remote… its button.
    const a = await h.ask({ title: `Remotes · ${remotes.length}`, confirm: "Add a remote…", width: 520, height: 560,
      entries: remotes.map((r, i) => ({ id: `r-${i}`, title: label(r), detail: r.fetch ?? "no URL", button: "⋯" })) });
    pick = !a ? null : a.choice ?? "add";
  }
  if (!pick || !h.same()) return;
  if (pick === "add") return addRemoteFlow(h, remotes);
  const r = remotes[Number(pick.slice(2))];
  if (r) return remoteFlow(h, r, { remotes, pushDefault, copy });
}

async function addRemoteFlow(h, remotes) {
  let name = "", url = "", error = null;
  for (;;) {
    const a = await h.ask({ title: "Add a remote", confirm: "Add", error, input: { value: name, placeholder: "name (origin, upstream…)", required: true }, detail: "Its URL comes next; it is fetched once added." });
    if (!a || !h.same()) return;
    name = a.text.trim();
    error = R.nameProblem(name, remotes) ?? ((await h.git(R.validNameArgs(name))).code === 0 ? null : `“${name}” can't be a remote's name`);
    if (!error) break;
  }
  const b = await h.ask({ title: `The URL of ${name}`, confirm: "Add and fetch", input: { value: url, placeholder: "git@host:owner/repo.git, https://…, a folder", required: true } });
  if (!b || !h.same()) return;
  return carryOut(h, R.addPlan({ name, url: b.text, remotes }), { kind: "fetch" });
}

async function remoteFlow(h, r, { remotes, pushDefault, copy }) {
  const pick = await h.choose({ title: r.name, width: 320, items: R.remoteItems(r, { pushDefault }) });
  if (!pick || !h.same()) return;
  const url = async (title, value) => (await h.ask({ title, confirm: "Save", input: { value: value ?? "", placeholder: "URL", required: true } }))?.text ?? null;
  switch (pick) {
    case "fetch": return carryOut(h, fetchPlan({ remote: r.name }), { kind: "fetch" });
    case "copy-url": return copy(r.fetch, "the URL");
    case "set-url": { const u = await url(`Change ${r.name}'s URL`, r.fetch); if (u && h.same()) return carryOut(h, R.setUrlPlan(r.name, u), { kind: "remote" }); return; }
    case "set-push-url": { const u = await url(`Where ${r.name} pushes to`, r.push[0] === r.fetch ? "" : r.push[0]); if (u && h.same()) return carryOut(h, R.setUrlPlan(r.name, u, { push: true }), { kind: "remote" }); return; }
    case "clear-push-url": return carryOut(h, R.clearPushUrlPlan(r.name), { kind: "remote" });
    case "push-default": return carryOut(h, R.pushDefaultPlan(r.name), { kind: "remote" });
    case "push-default-off": return carryOut(h, R.pushDefaultPlan(null), { kind: "remote" });
    case "set-head": return carryOut(h, R.setHeadPlan(r.name), { kind: "fetch" });
    case "rename": {
      const a = await h.ask({ title: `Rename remote ${r.name}`, confirm: "Rename", input: { value: r.name, required: true }, detail: "Its remote branches and the branches tracking it follow." });
      if (!a || !h.same()) return;
      return carryOut(h, R.renamePlan(r.name, a.text.trim(), { remotes, pushDefault }), { kind: "remote" });
    }
    case "remove": {
      const [tr] = await readPlan(h, plan([step(["for-each-ref", "--format=%(refname:short)%00%(upstream:remotename)", "refs/heads"], "Tracking")]));
      const tracking = tr.split("\n").map((l) => l.split("\0")).filter(([, rem]) => rem === r.name).map(([b]) => b);
      return carryOut(h, R.removePlan(r.name, { tracking }), { kind: "remote", yes: "Remove" });
    }
  }
}

// ---- The reflog

/** Reflog…: HEAD's newest entries, each with a button for its menu. */
export async function reflogFlow(h, { facts, version, copy }) {
  const [out] = await readPlan(h, plan([step(L.reflogArgs("HEAD", 200), "Reflog", { ok: [128] })]));
  const entries = L.parseReflog(out, "HEAD");
  const a = await h.ask({ title: "Reflog · HEAD", confirm: null, height: 560, width: 560, empty: "No reflog entries",
    entries: entries.map((e, i) => ({ id: `e-${i}`, title: `${short(e.sha)} · ${e.subject}`, detail: `${e.selector} · ${e.action}${e.message ? `: ${e.message}` : ""} · ${ago(e.time)}`, button: "⋯" })) });
  const e = a?.choice ? entries[Number(a.choice.slice(2))] : null;
  if (!e || !h.same()) return;
  const pick = await h.choose({ title: `${short(e.sha)} · ${e.subject}`, width: 300, items: L.entryItems(e, { branch: facts.branch, head: facts.head }) });
  if (!pick || !h.same()) return;
  if (pick === "copy") return copy(e.sha, "the hash");
  if (pick === "reset") return carryOut(h, L.resetPlan(e, { branch: facts.branch }), { kind: "reset", yes: `Move ${facts.branch}`, at: { branch: facts.branch, head: facts.head } });
  if (pick === "detach") return carryOut(h, L.detachPlan(e, { version }), { kind: "switch", yes: "Check out" });
  let name = "", error = null;
  for (;;) {
    const b = await h.ask({ title: `A branch at ${short(e.sha)}`, confirm: "Create", error, input: { value: name, placeholder: "new-branch-name", required: true }, detail: "Nothing else moves; you stay where you are." });
    if (!b || !h.same()) return;
    name = b.text.trim();
    if (await validBranchName(h, name).catch(() => false)) break;
    error = `“${name}” can't be a branch name`;
  }
  return carryOut(h, L.branchPlan(e, name), { kind: "branch" });
}
