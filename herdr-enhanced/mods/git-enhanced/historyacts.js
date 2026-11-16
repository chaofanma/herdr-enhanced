// What the History page does past the commit menu's own dialogs (commitmenu.js): rewriting history
// from a commit (reword, squash into its parent, drop, an interactive rebase), a worktree at a
// commit, the commit's page on the web, every label's menu (a branch, a remote branch, a tag), and
// the uncommitted changes' Commit, Stash and Discard. Every rewrite asks first, and a pushed commit
// is only rewritten when the person ticks that they know.
// Nothing here reads a view: a flow gets `h`, a host (gitops.js runnerOf's git/sh/files for the
// repository, question.js ask/choose, act(kind, work): runs the work then reloads the pages,
// note(text): a line on the page, same(): still the same repository) and the facts it needs.
import * as G from "./gitops.js";
import { chainOf, rewriteBlock, planFor, editorPlan, runPlan, webUrl, siteOf, WORKTREE_SH } from "./rewrite.js";
import { refItems, defaultRemote, splitRemote, deleteRemoteQuestion, deleteTagQuestion, upstreamQuestion, publishQuestion } from "./refs.js";
import { integrateQuestion, renameQuestion, deleteQuestion, forceDeleteQuestion, notMerged, stoppedNote, remoteTarget, remoteUpstream } from "./branches.js";
import { discardFlow } from "./undoui.js";
import * as T from "./tagops.js";
import { cherryPickPlan, revertPlan } from "./commitsel.js";
import { copyCommitsFlow } from "./patchui.js";
import { carryOut, readPlan, pinned, stillAt } from "./planflow.js";
import { plan, step } from "./gitplan.js";
import { readWorktrees, elsewhere } from "./worktrees.js";
import { withWorktree, forgetFlow, deleteThereFlow } from "./wtbranch.js";

const plural = (n, word) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);
const said = (e) => String(e?.message ?? e ?? "").trim().split("\n")[0] || "no reason given";
const off = (why) => (why ? { disabled: true, detail: why } : {});
const PUSHED = { id: "pushed", required: true, value: false, label: "It is pushed: I know its history then differs from the remote's (a push needs --force)" };

/** A commit's whole message. */
export async function messageOf(h, sha) {
  const r = await h.git(["log", "-1", "--format=%B", sha, "--"]);
  return r.code === 0 ? r.stdout.replace(/\s+$/, "") : "";
}

// After a rebase that stopped: what to do next.
const stopped = (words) => `The rebase stopped: ${words.split("\n").find((l) => /CONFLICT|could not apply/i.test(l)) ?? words.split("\n")[0]}. Resolve it in Changes and run git rebase --continue, or Abort here.`;

/** "Reset main to here ›" on commit `c` ({ sha, short, subject }): which reset (git reset --soft,
 *  --mixed, --hard), then `ask(mode)` opens the question that resets (commitmenu.js). */
export async function resetFlow(h, { c, branch, ask }) {
  const pick = await h.choose({ title: `Reset ${branch ?? "HEAD"} to ${c.short}`, width: 280, items: [
    { id: "soft", label: "Soft · keep changes staged…" },
    { id: "mixed", label: "Mixed · keep changes unstaged…" },
    { id: "hard", label: "Hard · discard changes…", danger: true },
  ] });
  if (!pick || !h.same()) return;
  ask(pick);
}

/** "Interactive rebase ›" on commit `c` ({ sha, short, subject }): what can be done from it (git
 *  rebase -i's reword, squash, drop, or its editor), then that.
 *  `openEditor(rows, facts)`: opens the interactive rebase's editor and resolves with its answer. */
export async function rewriteFlow(h, { c, branch, openEditor }) {
  // What is rewritten is the checked-out branch: it runs only while that is still `branch`, here.
  const at = await pinned(h, { branch: branch ?? null });
  if (!at) return;
  const ch = await chainOf(h, c.sha);
  const why = (action) => rewriteBlock(ch, { sha: c.sha, action, pushedOk: true });
  const pushed = ch.pushed ? { detail: "already pushed: asks first" } : {};
  const items = [
    { id: "reword", label: "Reword…", ...pushed, ...off(why("reword")) },
    { id: "squash", label: "Squash into parent…", ...pushed, ...off(why("squash")) },
    { id: "drop", label: "Drop…", danger: true, ...pushed, ...off(why("drop")) },
    { id: "rebase-i", label: "Interactive rebase from here…", ...pushed, ...off(why("reword")) },
  ];
  const pick = await h.choose({ title: `Interactive rebase of ${branch ?? "HEAD"} from ${c.short}`, items, width: 300 });
  if (!pick || !h.same()) return;
  if (pick === "rebase-i") return rebaseFlow(h, { c, ch, branch, openEditor, at });
  return oneRewrite(h, { action: pick, c, ch, branch, at });
}

async function oneRewrite(h, { action, c, ch, branch, at }) {
  const after = ch.count > 1 ? ` The ${plural(ch.count - 1, "commit")} after it get new hashes.` : "";
  const own = action === "drop" ? "" : await messageOf(h, c.sha);
  const parent = ch.parent?.slice(0, 7);
  const spec = {
    reword: { title: `Reword ${c.short}?`, confirm: "Reword", detail: `Its message becomes what is written here (git rebase -i).${after}`, value: own },
    squash: { title: `Squash ${c.short} into ${parent}?`, confirm: "Squash", detail: `The two become one commit with this message.${after}`, value: action === "squash" ? `${await messageOf(h, ch.parent)}\n\n${own}` : "" },
    drop: { title: `Drop ${c.short}?`, confirm: "Drop", danger: true, detail: `"${c.subject}" and its changes leave ${branch ?? "HEAD"}.${after} On a conflict the rebase stops: resolve it in Changes, or abort it.` },
  }[action];
  const a = await h.ask({ title: spec.title, detail: spec.detail, confirm: spec.confirm, danger: spec.danger || ch.pushed, width: 540,
    input: action === "drop" ? undefined : { value: spec.value, multiline: true, required: true }, checks: ch.pushed ? [PUSHED] : undefined });
  if (!a || !h.same()) return;
  const plan = planFor(action, ch, { message: a.text });
  h.act(action, async () => { if (!(await stillAt(h, at))) return; const r = await runPlan(h, plan); if (r.stopped) h.note(stopped(r.stopped)); });
}

// The interactive rebase: the editor (rebaseedit.js) gets the commits from `c` up, oldest first.
async function rebaseFlow(h, { c, ch, branch, openEditor, at }) {
  const rows = [];
  for (const k of ch.chain) {
    const r = await h.git(["log", "-1", "--format=%s%x00%an%x00%B", k.sha, "--"]);
    const [subject = "", author = "", message = ""] = r.code === 0 ? r.stdout.split("\0") : [];
    rows.push({ sha: k.sha, short: k.sha.slice(0, 7), subject, author, message: message.replace(/\s+$/, "") });
  }
  const answer = await openEditor({ rows, branch: branch ?? "HEAD", from: c.short, pushed: ch.pushed });
  if (!answer || !h.same()) return;
  const plan = editorPlan(ch, answer.rows, answer.messages);
  h.act("rebase", async () => { if (!(await stillAt(h, at))) return; const r = await runPlan(h, plan); if (r.stopped) h.note(stopped(r.stopped)); });
}

/** "Create worktree here…": a new branch at commit `c` checked out in Herdr's worktree folder,
 *  opened as a space (`open(path, argv)`: space.new), with the space's agent started there if
 *  ticked (`starter`: { name, argv }). */
export async function worktreeFlow(h, { c, starter, open }) {
  let name = "", error = null;
  for (;;) {
    const a = await h.ask({ title: `New worktree at ${c.short}`, confirm: "Create", error,
      detail: "A new branch at this commit, checked out in ~/.herdr/worktrees/<repository>/<branch> (where Herdr's own worktree dialog puts them) and opened as a space.",
      input: { value: name, placeholder: "branch name", required: true },
      checks: starter?.argv?.length ? [{ id: "agent", label: `Start ${starter.name || starter.argv[0]} there`, value: true }] : undefined });
    if (!a || !h.same()) return;
    name = a.text.trim();
    if (!(await G.validBranchName(h, name).catch(() => false))) { error = `"${name}" can't be a branch name`; continue; }
    const r = await h.sh(WORKTREE_SH, [name, c.sha], { timeout: 600000 });
    if (r.code !== 0) { error = r.stderr.trim().split("\n").pop() || "git worktree add failed"; continue; }
    open(r.stdout.trim(), a.checks?.agent ? starter.argv : null);
    h.act("worktree", async () => {});
    return;
  }
}

/** The menu of several selected commits (commitsel.js): cherry-pick them onto `current` oldest
 *  first, revert them newest first, copy them as email patches, or clear the selection. */
export async function selectionFlow(h, { commits, order, current, copy, clear, version = null }) {
  const k = commits.length, merge = commits.some((c) => (c.parents?.length ?? 0) > 1);
  const at = await pinned(h, { branch: current ?? null });
  if (!at) return;
  const pick = await h.choose({ title: `${k} commits selected`, width: 300, items: [
    { id: "pick", label: `Cherry-pick ${k} commits onto ${current ?? "HEAD"}…`, detail: "Oldest first" },
    { id: "revert", label: `Revert ${k} commits…`, detail: "Newest first; new commits undo them" },
    { id: "email", label: "Copy as email patches" },
    { id: "clear", label: "Clear the selection" },
  ] });
  if (!pick || !h.same()) return;
  if (pick === "clear") return clear();
  if (pick === "email") return copyCommitsFlow(h, { hashes: order.filter((x) => commits.some((c) => c.hash === x)), copy });
  const picking = pick === "pick";
  const a = await h.ask({ title: picking ? `Cherry-pick ${k} commits` : `Revert ${k} commits`, confirm: "Next…",
    checks: [...(picking ? [{ id: "x", label: "Note where each came from (-x)", value: false }] : []), { id: "noCommit", label: "Without committing", value: false },
      ...(merge ? [{ id: "mainline", label: "Merge commits against their first parent (-m 1)", value: true }] : [])] });
  if (!a || !h.same()) return;
  const opts = { x: Boolean(a.checks.x), noCommit: Boolean(a.checks.noCommit), mainline: a.checks.mainline ? 1 : null };
  const p = picking ? cherryPickPlan(commits, order, opts, { current, version }) : revertPlan(commits, order, opts, { current, version });
  return carryOut(h, p, { kind: picking ? "cherryPick" : "revert", yes: picking ? "Cherry-pick" : "Revert", after: () => clear(), at,
    stopped: (said) => `Stopped on conflicts: ${said.split("\n").find((l) => /^CONFLICT|could not apply|error:/i.test(l)) ?? said.split("\n")[0]}. Resolve them in Changes, then Continue, Skip or Abort.` });
}

/** Tag…: a new tag on commit `c` (a name, then a message: an annotated tag, or none for a
 *  lightweight one), or another tag moved here (asks: who fetched it keeps the old one). */
export async function tagFlow(h, { c }) {
  const tags = T.parseTags((await readPlan(h, plan([step(T.tagsArgs(), "Tags")])))[0]), elsewhere = tags.filter((t) => t.commit !== c.sha);
  let how = "new";
  if (elsewhere.length) {
    how = await h.choose({ title: `Tag ${c.short}`, width: 280, items: [{ id: "new", label: "New tag here…" }, { id: "move", label: "Move a tag here…", danger: true, detail: `${elsewhere.length} tag${elsewhere.length === 1 ? "" : "s"} elsewhere` }] });
    if (!how || !h.same()) return;
  }
  if (how === "move") {
    // Every tag, in a list that scrolls (newest first).
    const a = await h.ask({ title: `Move a tag to ${c.short} · ${elsewhere.length}`, confirm: null, width: 460, height: 520,
      entries: elsewhere.map((t, i) => ({ id: `t-${i}`, title: t.name, detail: `now on ${String(t.commit).slice(0, 7)}`, button: "Move here…" })) });
    if (!a?.choice || !h.same()) return;
    const t = elsewhere[Number(a.choice.slice(2))];
    if (!t) return;
    return carryOut(h, T.tagPlan(t.name, { rev: c.sha, message: t.annotated ? t.message : null, force: true }, { was: t.commit }), { kind: "tag", yes: "Move it" });
  }
  let name = "", error = null;
  for (;;) {
    const a = await h.ask({ title: `Tag ${c.short}`, confirm: "Next…", error, input: { value: name, placeholder: "v1.2.0", required: true }, detail: c.subject });
    if (!a || !h.same()) return;
    name = a.text.trim();
    error = T.nameProblem(name, tags.map((t) => t.name)) ?? ((await h.git(T.validTagArgs(name))).code === 0 ? null : `“${name}” can't be a tag's name`);
    if (!error) break;
  }
  const m = await h.ask({ title: `Tag ${c.short} as ${name}`, confirm: "Tag", width: 520, detail: "With a message it is an annotated tag (who and when are kept); empty, a lightweight one.",
    input: { value: "", placeholder: "Message (optional)", multiline: true } });
  if (!m || !h.same()) return;
  return carryOut(h, T.tagPlan(name, { rev: c.sha, message: m.text?.trim() ? m.text : null }, { tags: tags.map((t) => t.name) }), { kind: "tag" });
}

/** The web page of commit `sha` from the remote's URL (the upstream's remote, else origin…), or
 *  null: { url, site }. */
export async function webPage(h, sha, upstreamRemote = null) {
  const remotes = await G.remoteNames(h).catch(() => []), remote = defaultRemote(remotes, upstreamRemote);
  const url = remote ? webUrl(await G.remoteUrl(h, remote), sha) : null;
  return url ? { url, site: siteOf(url) } : null;
}

/** A label's menu, then the chosen action. `ref` ({ kind, name }: gitlog.js), `current` (the
 *  checked-out branch), `operation` (what is in progress), `dirty` (uncommitted changes). A branch
 *  checked out in another worktree (a remote branch's local one): its worktree, read now, is gone to
 *  instead of checking it out, and Delete… removes or detaches it first (wtbranch.js); `version`
 *  (git's), `top` (this worktree's folder), `spaces` (wtspaces.js), `placeOf` (a folder as shown). */
export async function refFlow(h, { ref, current, operation, dirty, version = null, top = null, spaces = null, placeOf = (p) => p }) {
  const { local, remote: remoteList } = await G.branchRefs(h);
  const remotes = await G.remoteNames(h).catch(() => []);
  const b = ref.kind === "branch" ? local.find((x) => x.name === ref.name) ?? { name: ref.name, current: ref.current, upstream: null } : null;
  const head = local.find((x) => x.current), upRemote = head?.upstream ? remotes.find((r) => head.upstream.startsWith(`${r}/`)) : null;
  const rb = ref.kind === "remote" ? remoteList.find((x) => x.name === ref.name) ?? { name: ref.name, remote: splitRemote(ref)[0], branch: splitRemote(ref).slice(1).join("/") } : null;
  const target = rb ? remoteTarget(rb, local) : null;
  const worktrees = ref.kind === "tag" ? [] : await readWorktrees(h.reads ?? h, version).catch(() => []), away = elsewhere(worktrees, top);
  const mine = b && !b.current && !ref.current ? b.name : target?.local ?? null, w = mine ? away.get(mine) ?? null : null, place = w ? placeOf(w.path) : null;
  let items = refItems(ref, { b, current, operation, remote: defaultRemote(remotes, upRemote), tracker: target?.local ?? null });
  if (w) items = withWorktree(items, w, place, rb ? mine : null);
  // A tag's menu starts with what it is: annotated (who, when, its message's first line) or lightweight.
  if (ref.kind === "tag") {
    const t = T.parseTags((await h.git(T.detailsArgs(ref.name))).stdout)[0];
    if (t) items.unshift({ id: "about", disabled: true, label: t.annotated ? t.subject || "(no message)" : "A lightweight tag",
      detail: t.annotated ? `${t.tagger ?? "?"} · ${new Date(t.time * 1000).toISOString().slice(0, 10)}${t.signed ? " · signed" : ""}` : "No tagger or message of its own" });
  }
  const kind = ref.kind === "tag" ? "Tag" : ref.kind === "remote" ? "Remote branch" : "Branch";
  const pick = await h.choose({ title: `${kind} ${ref.name}`, items, width: 280 });
  if (!pick || !h.same()) return;
  const remote = defaultRemote(remotes, upRemote);
  switch (pick) {
    case "checkout": return h.act("switch", () => G.switchBranch(h, b.name));
    case "merge": case "rebase": {
      if (!(await h.ask(integrateQuestion({ how: pick, b, current, dirty, upstream: head?.upstream ?? null }))) || !h.same()) return;
      return h.act(pick, async () => { const r = await (pick === "merge" ? G.mergeBranch : G.rebaseOnto)(h, b.name); if (r.stopped) h.note(stoppedNote(pick, r.stopped)); });
    }
    case "push": {
      const upstreamRemote = remoteUpstream(b) ? remotes.find((r) => b.upstream.startsWith(`${r}/`)) ?? null : null;
      if (b.localUpstream && (!(await h.ask(publishQuestion(b, remote))) || !h.same())) return;
      return h.act("push", () => G.pushLocalBranch(h, b, { remote, upstreamRemote }));
    }
    case "upstream": {
      const names = remoteList.map((x) => x.name);
      if (!names.length) { h.note("There are no remote branches to track: fetch, or publish this branch first"); return; }
      const a = await h.ask(upstreamQuestion(b, names));
      if (!a?.choice || !h.same() || a.choice === b.upstream) return;
      return h.act("upstream", () => G.setUpstream(h, b.name, a.choice));
    }
    case "rename": return renameFlow(h, b);
    case "worktree": return spaces?.go(w.path, worktrees);
    case "forget": return forgetFlow(h, w, worktrees);
    case "delete": return w ? deleteThereFlow(h, b, { w, place, list: worktrees, spaces }) : deleteFlow(h, b);
    case "track": return h.act("switch", () => G.switchRemote(h, rb, local));
    case "fetch": return h.act("fetch", () => G.fetchFrom(h, rb.remote));
    case "delete-remote": {
      if (!(await h.ask(deleteRemoteQuestion(rb.remote, rb.branch, 1))) || !h.same()) return;
      if (!(await h.ask(deleteRemoteQuestion(rb.remote, rb.branch, 2))) || !h.same()) return;
      return h.act("deleteRemote", () => G.deleteRemoteBranch(h, rb.remote, rb.branch));
    }
    case "push-tag": return h.act("push", () => G.pushTag(h, remote, ref.name));
    case "delete-tag": {
      const a = await h.ask(deleteTagQuestion(ref.name, remote));
      if (!a || !h.same()) return;
      return h.act("deleteTag", async () => { await G.deleteTag(h, ref.name); if (a.checks?.remote) await G.deleteRemoteTag(h, remote, ref.name); });
    }
  }
}

async function renameFlow(h, b) {
  let name = b.name, error = null;
  for (;;) {
    const a = await h.ask(renameQuestion(b, name, error));
    if (!a || !h.same()) return;
    name = a.text.trim();
    if (name === b.name) return;
    if (await G.validBranchName(h, name).catch(() => false)) break;
    error = `"${name}" can't be a branch name`;
  }
  h.act("renameBranch", () => G.renameBranch(h, b.name, name));
}

async function deleteFlow(h, b) {
  if (!(await h.ask(deleteQuestion(b))) || !h.same()) return;
  try { await G.deleteBranch(h, b.name, false); h.act("deleteBranch", async () => {}); }
  catch (e) {
    if (!notMerged(e.message)) { h.note(`Delete failed: ${said(e)}`); return; }
    if (!(await h.ask(forceDeleteQuestion(b, e.message))) || !h.same()) return;
    h.act("deleteBranch", () => G.deleteBranch(h, b.name, true));
  }
}

/** The uncommitted changes' menu: Commit…, Stash…, Discard all… (`pick`: one of them, from its
 *  button, without the menu). `staged`: files staged now; `count`: files changed. */
export async function uncommittedFlow(h, { staged, count, where, pick = null }) {
  pick ??= await h.choose({ title: `${plural(count, "uncommitted file")}`, width: 260, items: [
    { id: "commit", label: "Commit…", detail: staged ? `what is staged (${plural(staged, "file")})` : "everything (nothing is staged)" },
    { id: "stash", label: "Stash…" },
    { id: "discard", label: "Discard all…", danger: true },
  ] });
  if (!pick || !h.same()) return;
  if (pick === "commit") {
    const a = await h.ask({ title: staged ? `Commit ${plural(staged, "staged file")}` : `Commit all ${plural(count, "file")}`, confirm: "Commit", width: 520,
      detail: staged ? "What is staged becomes a commit; unstaged changes stay." : "Nothing is staged: every change is staged and committed (git add -A).", input: { value: "", placeholder: "Commit message", multiline: true, required: true } });
    if (!a || !h.same()) return;
    return h.act("commit", () => G.commitStaged(h, { message: a.text, stageAll: !staged }));
  }
  if (pick === "stash") {
    const a = await h.ask({ title: "Stash the uncommitted changes", confirm: "Stash", detail: "They leave the working tree and wait in the stash list (Changes: Stashes) to be applied again.",
      input: { value: "", placeholder: "A note for the stash (optional)" }, checks: [{ id: "untracked", label: "New files too", value: true }] });
    if (!a || !h.same()) return;
    return h.act("stash", () => G.stashPush(h, { message: a.text ?? "", mode: "all", untracked: Boolean(a.checks?.untracked) }));
  }
  return discardFlow(h, { title: "Discard every uncommitted change?", detail: `Every tracked file goes back to HEAD and new files are deleted in ${where}, staged changes included; ignored files stay.`,
    confirm: "Discard all", keep: { mode: "all", paths: [], message: "Discard all" }, work: () => G.revertEverything(h) });
}
