// Remotes (the History page's Remotes… dialog and the remote rows of the branch picker): what
// `git remote -v` says, and adding, renaming, re-pointing (fetch and push URLs) and removing a
// remote, with the remote a push goes to when nothing says (remote.pushDefault). A remote's name
// goes after "--" wherever git takes one: a remote may be called "-f".
// No Herdr imports: tested with node (test/git-enhanced/remoteops.test.mjs).
import { step, plan, problem } from "./gitplan.js";

/** git's arguments that list the remotes with their URLs, a line each: "<name>\t<url> (fetch)"
 *  and "<name>\t<url> (push)" (those two words are git's own, not translated). */
export const REMOTES_ARGS = ["remote", "-v"];

/** `git remote -v` as [{ name, fetch, push }] in git's order: `fetch` the URL fetches use (null
 *  without one), `push` the URLs a push goes to (git lists every one; the fetch URL when there is
 *  no push URL). A URL may hold spaces (a folder's path). */
export function parseRemotes(stdout) {
  const out = [], by = new Map();
  for (const line of String(stdout ?? "").split("\n")) {
    const tab = line.indexOf("\t"), m = / \((fetch|push)\)$/.exec(line);
    if (tab <= 0 || !m) continue;
    const name = line.slice(0, tab), url = line.slice(tab + 1, m.index);
    let r = by.get(name);
    if (!r) { r = { name, fetch: null, push: [] }; by.set(name, r); out.push(r); }
    if (m[1] === "fetch") r.fetch ??= url;
    else if (!r.push.includes(url)) r.push.push(url);
  }
  return out;
}

/** git's arguments that read remote.pushDefault (exit 1 when it isn't set). */
export const PUSH_DEFAULT_ARGS = ["config", "--get", "remote.pushDefault"];
/** That output as a remote's name, or null. */
export const parsePushDefault = (stdout) => String(stdout ?? "").trim() || null;

/** git's arguments that check `name` can be a remote's name (git's own rule: refs/remotes/<name>/…
 *  must be a valid ref; exit 0 when it can). */
export const validNameArgs = (name) => ["check-ref-format", `refs/remotes/${name}/x`];

/** Why `name` can't be a new remote's name before git is asked (empty, taken), or null. */
export function nameProblem(name, remotes = []) {
  const n = String(name ?? "").trim();
  if (!n) return "A remote needs a name";
  if (remotes.some((r) => (r.name ?? r) === n)) return `There is a remote called ${n} already`;
  if (/\s/.test(n)) return "A remote's name can't hold spaces";
  return null;
}

/** Add remote `name` at `url`; `fetch`: fetch it right away. */
export function addPlan({ name, url, fetch = true, remotes = [] } = {}) {
  const why = nameProblem(name, remotes) ?? (!String(url ?? "").trim() ? "A remote needs a URL" : null);
  if (why) return problem(why);
  return plan([step(["remote", "add", "--", name, url.trim()], `Add remote ${name}`), fetch && step(["fetch", "--prune", "--", name], `Fetch ${name}`, { net: true, slow: true })]);
}

/** Rename remote `from` to `to`: git moves its remote branches and the branches that track it
 *  along; remote.pushDefault follows too (`pushDefault`: what it is now). */
export function renamePlan(from, to, { remotes = [], pushDefault = null } = {}) {
  const why = nameProblem(to, remotes.filter((r) => (r.name ?? r) !== from));
  if (why) return problem(why);
  if (from === to) return problem("That is its name already");
  return plan([
    step(["remote", "rename", "--", from, to], `Rename remote ${from} to ${to}`, { slow: true }),
    pushDefault === from && step(["config", "remote.pushDefault", to], `Pushes still go to ${to} by default`),
  ]);
}

/** Point remote `name` at `url`: where it fetches from (and pushes to, without a push URL), or
 *  with `push` only where it pushes to. */
export function setUrlPlan(name, url, { push = false } = {}) {
  if (!String(url ?? "").trim()) return problem("A remote needs a URL");
  return plan([step(["remote", "set-url", ...(push ? ["--push"] : []), "--", name, url.trim()], push ? `${name} pushes to ${url.trim()}` : `${name} is at ${url.trim()}`)]);
}

/** Drop remote `name`'s push URLs: pushes go to its fetch URL again (exit 5: it had none). */
export const clearPushUrlPlan = (name) => plan([step(["config", "--unset-all", `remote.${name}.pushurl`], `${name} pushes where it fetches from`, { ok: [5] })]);

/** Remove remote `name`. Its remote branches go here, and `tracking` (the local branches whose
 *  upstream is on it) lose their upstream; the repository it points at isn't touched. */
export function removePlan(name, { tracking = [] } = {}) {
  const lose = tracking.length ? ` ${tracking.length === 1 ? `${tracking[0]} loses its upstream` : `${tracking.slice(0, 5).join(", ")}${tracking.length > 5 ? "…" : ""} lose their upstream`}.` : "";
  return plan([step(["remote", "remove", "--", name], `Remove remote ${name}`, { slow: true })],
    { danger: true, confirm: `Remove remote ${name}? Its remote branches (${name}/…) go from this repository.${lose} The repository it points at isn't touched; add it again to get them back.` });
}

/** Where pushes go when a branch's own config doesn't say: remote `name`, or (null) no default. */
export const pushDefaultPlan = (name) => (name
  ? plan([step(["config", "remote.pushDefault", name], `Pushes go to ${name} by default`)])
  : plan([step(["config", "--unset", "remote.pushDefault"], "No default remote for pushes", { ok: [5] })]));

/** Ask remote `name` which branch is its default (refs/remotes/<name>/HEAD, the base the pages
 *  compare with). */
export const setHeadPlan = (name) => plan([step(["remote", "set-head", "--auto", "--", name], `Ask ${name} for its default branch`, { net: true })]);

/** The menu of remote `r` (parseRemotes): `pushDefault`, the default remote's name. */
export function remoteItems(r, { pushDefault = null } = {}) {
  const own = r.push.length && !(r.push.length === 1 && r.push[0] === r.fetch);
  return [
    { id: "fetch", label: `Fetch ${r.name}` },
    { id: "copy-url", label: "Copy URL", detail: r.fetch ?? undefined, disabled: !r.fetch },
    { id: "set-url", label: "Change URL…" },
    { id: "set-push-url", label: own ? "Change push URL…" : "Set a push URL…", detail: own ? r.push.join(", ") : "Pushes go to the URL above" },
    ...(own ? [{ id: "clear-push-url", label: "Push to the URL above again" }] : []),
    pushDefault === r.name ? { id: "push-default-off", label: "Stop being the default for pushes" } : { id: "push-default", label: "Push here by default" },
    { id: "set-head", label: "Find its default branch" },
    { id: "rename", label: "Rename…" },
    { id: "remove", label: "Remove…", danger: true },
  ];
}
