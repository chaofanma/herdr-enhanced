// Branches (the branch picker's right-click menu and Remote branches; gitops.js runs git): the
// refs as git lists them, where a click on a remote branch goes, and what is in progress (a merge
// or rebase that stopped). No Herdr imports: tested with node (test/git-enhanced/branches.test.mjs).

/** `git for-each-ref` over refs/heads and refs/remotes: full name, age, current, upstream, symref
 *  (for-each-ref writes a byte as %1f). */
export const BRANCH_FORMAT = "--format=%(refname)%1f%(committerdate:relative)%1f%(HEAD)%1f%(upstream)%1f%(symref)";

/** The remote a remote-tracking ref's short name ("origin/feature/x") belongs to: the longest
 *  of `remotes` it starts with (a remote's name may hold a slash). */
export function remoteOf(short, remotes) {
  return [...remotes].sort((a, b) => b.length - a.length).find((r) => short.startsWith(`${r}/`)) ?? short.split("/")[0];
}

/** for-each-ref's lines (BRANCH_FORMAT), most recently committed first, as
 *  `{ local: [{ name, age, current, upstream, localUpstream? }], remote: [{ name, remote, branch, age }] }`;
 *  `upstream` is a short name ("origin/main"; "main", with `localUpstream`, when it is a local
 *  branch) or null; a remote's HEAD (a symref) is left out. */
export function parseBranchRefs(stdout = "", remotes = []) {
  const local = [], remote = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [ref, age = "", head = "", upstream = "", symref = ""] = line.split("\x1f");
    const mine = upstream.startsWith("refs/heads/");
    if (ref.startsWith("refs/heads/")) local.push({ name: ref.slice(11), age, current: head === "*", upstream: upstream.startsWith("refs/remotes/") ? upstream.slice(13) : mine ? upstream.slice(11) : upstream || null, ...(mine ? { localUpstream: true } : {}) });
    else if (ref.startsWith("refs/remotes/") && !symref && !ref.endsWith("/HEAD")) {
      const name = ref.slice(13), r = remoteOf(name, remotes);
      remote.push({ name, remote: r, branch: name.slice(r.length + 1), age });
    }
  }
  return { local, remote };
}

/** The remote branch that local branch `b` (parseBranchRefs') tracks, "origin/main", or null: none,
 *  or a local branch. */
export const remoteUpstream = (b) => (b?.upstream && !b.localUpstream && !b.upstream.startsWith("refs/") ? b.upstream : null);
/** `b`'s upstream as a full ref ("refs/remotes/origin/main", "refs/heads/main"), or null. */
export const upstreamRef = (b) => (!b?.upstream ? null : b.upstream.startsWith("refs/") ? b.upstream : b.localUpstream ? `refs/heads/${b.upstream}` : `refs/remotes/${b.upstream}`);

/** Where a click on remote branch `rb` goes: the local branch that tracks it, else the local
 *  branch of the same name (`{ local }`, git switch), else a new one tracking it (`{ track }`,
 *  git switch --track). */
export function remoteTarget(rb, local) {
  const tracking = local.find((b) => remoteUpstream(b) === rb.name) ?? local.find((b) => b.name === rb.branch);
  return tracking ? { local: tracking.name } : { track: rb.name };
}

/** The right-click menu of local branch `b`: Rename… always; Delete…, Merge into the current
 *  branch and Rebase the current branch onto it for another branch, while a branch is checked
 *  out (`current`: its name, null on a detached HEAD) and nothing is in progress (`busy`).
 *  `not` ({ rename, delete }): why those can't run (wtbranch.js whyNot), else null. */
export function branchMenu(b, current, busy = null, not = {}) {
  const off = (r) => (r ? { disabled: true, detail: r } : {});
  const items = [{ id: "rename", label: "Rename…", ...off(not.rename) }];
  if (b.current) return items;
  const why = busy ? `Not while a ${busy} is in progress` : !current ? "No branch is checked out" : null;
  items.push({ id: "delete", label: "Delete…", danger: true, ...off(not.delete) });
  items.push({ id: "merge", label: current ? `Merge into ${current}…` : "Merge into the current branch…", disabled: Boolean(why), detail: why ?? undefined });
  items.push({ id: "rebase", label: current ? `Rebase ${current} onto it…` : "Rebase the current branch onto it…", disabled: Boolean(why), detail: why ?? undefined });
  return items;
}

/** git refused to delete a branch whose commits aren't merged (git branch -d): -D would. */
export const notMerged = (message) => /not fully merged/.test(String(message ?? ""));

/** The marks of a stopped operation in a git dir: a `git am` session keeps its state where a rebase
 *  does (rebase-apply), and says so with rebase-apply/applying. */
export const OPERATION_MARKS = "rebase-merge rebase-apply rebase-apply/applying MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD";
/** sh's script that prints which of a stopped operation's marks the repo's git dir holds. */
export const OPERATION_SH = `g=$(git rev-parse --git-dir) || exit 1; for f in ${OPERATION_MARKS}; do [ -e "$g/$f" ] && echo "$f"; done; exit 0`;

/** What is in progress from OPERATION_SH's lines: "rebase", "am", "merge", "cherry-pick", "revert"
 *  or null. */
export function operationOf(stdout = "") {
  const marks = new Set(stdout.split("\n").map((l) => l.trim()).filter(Boolean));
  if (marks.has("rebase-apply/applying")) return "am";
  if (marks.has("rebase-merge") || marks.has("rebase-apply")) return "rebase";
  if (marks.has("MERGE_HEAD")) return "merge";
  if (marks.has("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (marks.has("REVERT_HEAD")) return "revert";
  return null;
}

/** git's arguments that abort operation `op` (operationOf). */
export const abortArgs = (op) => [op, "--abort"];

/** The bar's words for a stopped operation with `conflicts` files still in conflict. */
export function operationWords(op, conflicts) {
  const name = op === "cherry-pick" ? "Cherry-pick" : op === "am" ? "git am" : op[0].toUpperCase() + op.slice(1);
  return conflicts ? `${name} stopped: ${conflicts} file${conflicts === 1 ? "" : "s"} conflict` : `${name} in progress: no conflicts left`;
}

/** The question for a branch's new name (asked again with `error` while git refuses the name). */
export const renameQuestion = (b, name, error = null) => ({
  title: `Rename ${b.name}`, confirm: "Rename", error, input: { value: name, placeholder: "new-branch-name", required: true },
  detail: !b.upstream ? null : remoteUpstream(b) ? `It keeps tracking ${b.upstream}; the remote branch keeps its name.` : `It keeps tracking ${b.upstream}.`,
});

export const deleteQuestion = (b) => ({
  title: `Delete branch ${b.name}?`, confirm: "Delete", danger: true,
  detail: `git branch -d ${b.name}: git refuses while it has commits merged nowhere else; then you're asked again.${remoteUpstream(b) ? ` Its remote branch ${b.upstream} stays.` : ""}`,
});

/** Asked again when git refused (git's `message`): delete with -D. */
export const forceDeleteQuestion = (b, message) => ({
  title: `${b.name} is not fully merged`, confirm: "Delete anyway", danger: true,
  detail: `Its commits that no other branch has would then be only in the reflog, which git cleans up after a while. git said: ${String(message).split("\n")[0]}`,
});

/** Merge `b` into the `current` branch, or rebase `current` onto `b` (`how`): `dirty`, there are
 *  uncommitted changes; `upstream`, current's upstream or null. */
export function integrateQuestion({ how, b, current, dirty, upstream }) {
  const merge = how === "merge";
  const detail = merge
    ? `git merge --no-edit ${b.name}: a fast-forward when ${current} has no commits of its own, else a merge commit with git's message. If it stops on conflicts, the bar over the files has Abort.${dirty ? " There are uncommitted changes: should the merge stop on conflicts, Abort can't always give them back as they were; stash them first to be safe." : ""}`
    : `git rebase ${b.name}: the commits on ${current} that ${b.name} doesn't have are made again on top of it, with new hashes.${upstream ? ` ${current} is on ${upstream}: after this they differ, and a push needs --force.` : ""}${dirty ? " git won't start with uncommitted changes; commit or stash them first." : ""}`;
  return { title: merge ? `Merge ${b.name} into ${current}?` : `Rebase ${current} onto ${b.name}?`, detail, confirm: merge ? "Merge" : "Rebase", danger: !merge };
}

/** Before aborting operation `op`: what goes. */
export function abortQuestion(op) {
  const detail = op === "merge" ? "git merge --abort: the files and the index go back to before the merge; conflicts resolved so far are lost."
    : op === "rebase" ? "git rebase --abort: the branch goes back to where it was before the rebase; commits already made again and conflicts resolved so far are dropped."
    : `git ${op} --abort: back to before the ${op}; conflicts resolved so far are lost.`;
  return { title: `Abort the ${op}?`, detail, confirm: "Abort", danger: true };
}

/** A merge or rebase that stopped: git's CONFLICT lines for the line under the diff. */
export const stoppedNote = (how, said) => `${how === "merge" ? "Merge" : "Rebase"} stopped on conflicts: ${said.split("\n").filter((l) => /^CONFLICT/.test(l)).join("\n") || said}`;
