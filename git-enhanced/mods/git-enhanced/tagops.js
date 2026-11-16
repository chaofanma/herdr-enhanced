// Tags (History's tag labels, "Tag this commit…" in a commit's menu, a Tags list): annotated tags
// with a message, moving a tag, pushing one tag or all of them, deleting one here and on a remote,
// and the details of each (tagger, date, message) from for-each-ref.
// No Herdr imports: tested with node (test/git-enhanced/tagops.test.mjs).
import { pushTagsArgs } from "./pullsync.js";
import { step, plan, problem } from "./gitplan.js";

const short = (h) => String(h ?? "").slice(0, 7);

/** git's arguments that check `name` can be a tag's name (exit 0 when it can). */
export const validTagArgs = (name) => ["check-ref-format", `refs/tags/${name}`];
/** Why `name` can't be a new tag's name before git is asked (empty, a leading "-", which git
 *  refuses though check-ref-format doesn't, taken), or null. */
export function nameProblem(name, tags = []) {
  const n = String(name ?? "").trim();
  if (!n) return "A tag needs a name";
  if (n.startsWith("-")) return "A tag's name can't start with -";
  if (/\s/.test(n)) return "A tag's name can't hold spaces";
  if (tags.includes(n)) return `There is a tag called ${n} already`;
  return null;
}

/** git tag `name` on `rev`: annotated with `message` (as written: lines starting with "#" stay,
 *  --cleanup=whitespace), else lightweight; `force` moves an existing tag there. Never signed here:
 *  with tag.gpgSign set, git would ask for a passphrase, and there is no terminal. */
export function tagArgs(name, { rev = "HEAD", message = null, force = false } = {}) {
  const annotated = Boolean(message?.trim());
  return ["-c", "tag.gpgSign=false", "tag", ...(annotated ? ["-a", "--cleanup=whitespace", "-m", message.replace(/\s+$/, "")] : []), ...(force ? ["-f"] : []), name, rev];
}

/** tagArgs as a plan; moving a tag (`force`, with `was`: where it is now) is a danger plan. */
export function tagPlan(name, opts = {}, { tags = [], was = null } = {}) {
  const why = nameProblem(name, opts.force ? [] : tags);
  if (why) return problem(why);
  const s = step(tagArgs(name.trim(), opts), `Tag ${short(opts.rev ?? "HEAD")} ${name.trim()}`);
  return opts.force
    ? plan([s], { danger: true, confirm: `Move tag ${name.trim()}${was ? ` from ${short(was)}` : ""} to ${short(opts.rev ?? "HEAD")}? Anyone who fetched it keeps the old one until they fetch it again by force.` })
    : plan([s]);
}

/** Push tag `tag` to `remote` (its full name, so a branch of the same name is no matter). */
export const pushTagArgs = (remote, tag) => ["push", "--", remote, `refs/tags/${tag}`];
export const pushTagPlan = (remote, tag) => plan([step(pushTagArgs(remote, tag), `Push ${tag} to ${remote}`, { net: true, slow: true })]);
/** Push every tag to `remote` (pullsync.js pushTagsArgs). */
export const pushAllPlan = (remote) => plan([step(pushTagsArgs(remote), `Push every tag to ${remote}`, { net: true, slow: true })]);

/** Delete tag `tag` here (`here`) and on `remote` (when given): the remote first, which can fail
 *  for reasons of its own, then here. A danger plan. `sha`: the commit it is on, for the question. */
export function deletePlan(tag, { remote = null, here = true, sha = null } = {}) {
  if (!here && !remote) return problem("Delete it where?");
  const where = here && remote ? `here and on ${remote}` : remote ? `on ${remote}` : "here";
  return plan([
    remote && step(["push", "--delete", "--", remote, `refs/tags/${tag}`], `Delete ${tag} on ${remote}`, { net: true, slow: true }),
    here && step(["tag", "-d", tag], `Delete ${tag} here`),
  ], { danger: true, confirm: `Delete tag ${tag} ${where}?${remote ? ` Clones that fetched it keep it.` : ""}${sha ? ` It can be made again on ${short(sha)}.` : ""}` });
}

/** for-each-ref's format for tags: name, its object's type and hash, the commit it is on (an
 *  annotated tag's, peeled), tagger, email, date ("<unix> <zone>") and message, NUL separated,
 *  each tag ending with a NUL before git's newline (a message can hold newlines, never a NUL). */
export const TAG_FORMAT = "--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objectname)%00%(taggername)%00%(taggeremail)%00%(taggerdate:raw)%00%(contents)%00";
/** git's arguments for every tag, newest first; for one tag. */
export const tagsArgs = () => ["for-each-ref", "--sort=-creatordate", TAG_FORMAT, "refs/tags"];
export const detailsArgs = (tag) => ["for-each-ref", TAG_FORMAT, `refs/tags/${tag}`];

/** tagsArgs' (or detailsArgs') output as [{ name, annotated, object, commit, tagger, email, time,
 *  zone, subject, message, signed }]: `commit` the commit it is on; for a lightweight tag (no tag
 *  object) the tagger and message are null (git would give the commit's); `signed`: the message
 *  ends with a signature, left out of `message`. */
export function parseTags(stdout) {
  const out = [];
  for (const rec of String(stdout ?? "").split("\0\n")) {
    const f = rec.replace(/^\n/, "").split("\0");
    if (f.length < 8 || !f[0].startsWith("refs/tags/")) continue;
    const [ref, type, object, peeled, name, email, date, ...rest] = f, contents = rest.join("\0");
    const annotated = type === "tag", [time = "0", zone = ""] = date.split(" ");
    const sig = annotated ? /\n?-----BEGIN (PGP|SSH) SIGNATURE-----[\s\S]*$/.exec(contents) : null;
    const message = annotated ? (sig ? contents.slice(0, sig.index) : contents).replace(/\s+$/, "") : null;
    out.push({
      name: ref.slice(10), annotated, object, commit: annotated ? peeled || null : object,
      tagger: annotated ? name || null : null, email: annotated ? email.replace(/^<|>$/g, "") || null : null,
      time: annotated ? Number(time) || 0 : 0, zone: annotated ? zone : "", subject: message === null ? null : message.split("\n")[0], message, signed: Boolean(sig),
    });
  }
  return out;
}
