// The History page's labels: what a branch, a remote branch or a tag on a commit offers (its menu),
// and git's arguments for each. gitops.js runs them; historyacts.js asks first where it should.
// No Herdr imports: tested with node (test/git-enhanced/refs.test.mjs).

/** The remote a push or fetch goes to when nothing says: the current branch's upstream's remote,
 *  else "origin" when there is one, else the first remote, else null. */
export function defaultRemote(remotes, upstreamRemote = null) {
  if (upstreamRemote && remotes.includes(upstreamRemote)) return upstreamRemote;
  return remotes.includes("origin") ? "origin" : remotes[0] ?? null;
}

/** A label's menu. `ref`: { kind: "branch" | "head" | "remote" | "tag", name } (gitlog.js refs);
 *  `b`: the local branch's facts ({ name, current, upstream }) when it is one; `current`: the
 *  checked-out branch (null: detached); `operation`: what is in progress; `remote`: where a push
 *  goes; `tracker`: the local branch that tracks a remote one. Items: { id, label, danger?,
 *  disabled?, detail? }. */
export function refItems(ref, { b = null, current = null, operation = null, remote = null, tracker = null } = {}) {
  const busy = operation ? `Not while a ${operation} is in progress` : null;
  if (ref.kind === "tag") {
    return [
      { id: "push-tag", label: remote ? `Push to ${remote}` : "Push", disabled: !remote, detail: remote ? undefined : "No remote to push to" },
      { id: "delete-tag", label: "Delete…", danger: true },
    ];
  }
  if (ref.kind === "remote") {
    const [r, ...rest] = splitRemote(ref);
    return [
      { id: "track", label: tracker ? `Check out ${tracker}` : "Check out (tracking)", disabled: Boolean(busy), detail: busy ?? (tracker ? `the local branch that tracks ${ref.name}` : `a new local ${rest.join("/")} tracking it`) },
      { id: "fetch", label: `Fetch ${r}` },
      { id: "delete-remote", label: `Delete it on ${r}…`, danger: true },
    ];
  }
  const name = b?.name ?? ref.name, here = b?.current ?? Boolean(ref.current);
  const why = busy ?? (!current ? "No branch is checked out" : null);
  const items = [];
  if (!here) items.push({ id: "checkout", label: `Check out ${name}`, disabled: Boolean(busy), detail: busy ?? undefined });
  if (!here) items.push({ id: "merge", label: current ? `Merge into ${current}…` : "Merge into the current branch…", disabled: Boolean(why), detail: why ?? undefined });
  if (!here) items.push({ id: "rebase", label: current ? `Rebase ${current} onto it…` : "Rebase the current branch onto it…", disabled: Boolean(why), detail: why ?? undefined });
  // A local branch as its upstream: publishing makes it track the remote's instead (asked: publishQuestion).
  if (b?.localUpstream) items.push({ id: "push", label: remote ? `Publish to ${remote}…` : "Publish", disabled: !remote, detail: remote ? `It then tracks ${remote}/${name}, not ${b.upstream}` : "No remote to publish to" });
  else items.push(b?.upstream ? { id: "push", label: `Push to ${b.upstream}` } : { id: "push", label: remote ? `Publish to ${remote}` : "Publish", disabled: !remote, detail: remote ? `git push -u ${remote} ${name}` : "No remote to push to" });
  items.push({ id: "upstream", label: b?.upstream ? "Change upstream…" : "Set upstream…" });
  items.push({ id: "rename", label: "Rename…" });
  if (!here) items.push({ id: "delete", label: "Delete…", danger: true });
  return items;
}

/** A remote branch's remote and branch ("origin/feature/x" → ["origin", "feature", "x"]), with the
 *  remote that ref.remote names when gitlog knows it. */
export const splitRemote = (ref) => (ref.remote ? [ref.remote, ...ref.name.slice(ref.remote.length + 1).split("/")] : ref.name.split("/"));

/** git push for local branch `b` ({ name, upstream }): to its upstream's branch, or published to
 *  `remote` under its own name and tracked (-u). `upstreamRemote`: the upstream's remote. */
export function pushArgs(b, { remote, upstreamRemote = null } = {}) {
  if (b.upstream && upstreamRemote && b.upstream.startsWith(`${upstreamRemote}/`)) {
    return ["push", upstreamRemote, `refs/heads/${b.name}:refs/heads/${b.upstream.slice(upstreamRemote.length + 1)}`];
  }
  return ["push", "-u", remote, `refs/heads/${b.name}:refs/heads/${b.name}`];
}
export const upstreamArgs = (name, remoteBranch) => ["branch", `--set-upstream-to=refs/remotes/${remoteBranch}`, name];
export const deleteRemoteArgs = (remote, branch) => ["push", remote, "--delete", `refs/heads/${branch}`];
export const fetchArgs = (remote) => ["fetch", "--prune", remote];
export const pushTagArgs = (remote, tag) => ["push", remote, `refs/tags/${tag}`];
export const deleteTagArgs = (tag) => ["tag", "-d", tag];
export const deleteRemoteTagArgs = (remote, tag) => ["push", remote, "--delete", `refs/tags/${tag}`];

// What each one asks first.
export const deleteRemoteQuestion = (remote, branch, step) => (step === 1
  ? { title: `Delete ${branch} on ${remote}?`, confirm: "Continue…", danger: true,
    detail: `git push ${remote} --delete ${branch}: the branch goes from ${remote} for everyone who uses it. Local branches stay.` }
  : { title: `Really delete ${remote}/${branch}?`, confirm: `Delete it on ${remote}`, danger: true,
    detail: "There is no undo here: anyone who hasn't fetched its commits can only get them from a clone that has them." });
export const deleteTagQuestion = (tag, remote) => ({
  title: `Delete tag ${tag}?`, confirm: "Delete", danger: true, detail: `git tag -d ${tag}: the tag goes here.`,
  checks: remote ? [{ id: "remote", label: `Also delete it on ${remote}`, value: false }] : undefined,
});
/** The remote branches an upstream can be, the current one ticked (a local branch as the upstream:
 *  the first). */
export const upstreamQuestion = (b, remoteNames) => ({
  title: `Upstream of ${b.name}`, confirm: "Set", detail: "Where Push and Pull go, and what ↑ and ↓ count against.",
  choices: { value: (b.localUpstream ? null : b.upstream) ?? remoteNames[0] ?? null, options: remoteNames.slice(0, 12).map((n) => ({ id: n, label: n })) },
});

/** Asked before publishing local branch `b` whose upstream is a local branch: it then tracks the
 *  remote's branch instead. */
export const publishQuestion = (b, remote) => ({
  title: `Publish ${b.name} to ${remote}?`, confirm: "Publish",
  detail: `git push -u ${remote} ${b.name}: ${b.name} then tracks ${remote}/${b.name} instead of ${b.upstream}.`,
});
