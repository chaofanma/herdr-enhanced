// Stashes (the Stashes popover, the Stash… dialog and the stash view; gitops.js runs git): what
// `git stash list` says about each one, a stash push's arguments, and git's own words when a
// stash, merge or rebase stops. No Herdr imports: tested with node (test/git-enhanced/stashes.test.mjs).

/** `git stash list`'s format: ref, hash, parents, relative time and reflog subject, one stash a
 *  line (a stash's subject is one line). */
export const STASH_FORMAT = "--format=%gd%x1f%H%x1f%P%x1f%cr%x1f%gs";

/** A stash's reflog subject as its parts: "On main: message" (git stash push -m) or "WIP on
 *  main: 1a2b3c4 subject" (no message). A branch name can't hold ":" (check-ref-format), so the
 *  first ": " ends it; a stash made on a detached HEAD says "(no branch)": null. */
export function stashSubject(gs = "") {
  const m = /^(WIP on|On) (.+?): ([\s\S]*)$/.exec(gs);
  if (!m) return { branch: null, message: gs, wip: false };
  return { branch: m[2] === "(no branch)" ? null : m[2], message: m[3], wip: m[1] === "WIP on" };
}

/** `git stash list` (STASH_FORMAT) as `{ ref, hash, parents, age, branch, message, wip, untracked }`,
 *  newest first; `untracked`: it holds untracked files (a third parent). */
export function parseStashList(stdout = "") {
  return stdout.split("\n").filter(Boolean).map((line) => {
    const [ref, hash, parents = "", age = "", gs = ""] = line.split("\x1f"), p = parents.split(" ").filter(Boolean);
    return { ref, hash, parents: p, age, ...stashSubject(gs), untracked: p.length >= 3 };
  });
}

/** git's arguments for a stash: everything (`mode` "all"; untracked files too unless `untracked`
 *  is false), only what is staged ("staged": `--staged`, which git won't combine with untracked
 *  files), or only `paths` ("files"; literal pathspecs, untracked ones included when `untracked`).
 *  `message` names it (git stash -m). */
export function stashPushArgs({ message = "", mode = "all", untracked = true, paths = [] } = {}) {
  const args = ["stash", "push"];
  if (message.trim()) args.push("-m", message.trim());
  if (mode === "staged") args.push("--staged");
  else if (untracked) args.push("--include-untracked");
  if (mode === "files") args.push("--", ...paths.map((p) => `:(literal)${p}`));
  return args;
}

/** What git said when a command failed or stopped (a stash pop with conflicts, a merge): its
 *  error, fatal, CONFLICT and "stash entry is kept" lines (with the files an error lists), not the
 *  status and hints it prints after them; else its first lines. */
export function gitSays({ stdout = "", stderr = "" } = {}) {
  const kept = [];
  let listing = false;
  // Progress ("Rebasing (1/2)") ends with a carriage return, not a new line.
  for (const line of `${stderr}\n${stdout}`.split(/\r\n|\r|\n/)) {
    if (/^(error|fatal|CONFLICT|Automatic merge failed|Could not apply|Cannot)\b/.test(line) || /stash entry is kept/.test(line)) { kept.push(line.trim()); listing = /^error\b/.test(line); }
    else if (listing && /^\s+\S/.test(line)) kept.push(line.trim());
    else listing = false;
  }
  if (kept.length) return [...new Set(kept)].join("\n");
  return (stderr.trim() || stdout.trim()).split(/\r\n|\r|\n/).filter((l) => l.trim() && !/^hint:/.test(l)).slice(0, 4).join("\n");
}

/** The question before dropping stash `s`. */
export const dropQuestion = (s) => ({
  title: `Drop ${s.ref}?`, confirm: "Drop", danger: true,
  detail: `“${s.message || "(no message)"}”, ${s.branch ? `on ${s.branch}` : "on a detached HEAD"}, ${s.age}. Dropping deletes it from the stash list; it can't be applied after that.`,
});

/** The Stash… dialog for the changed `paths` (`staged`: something is staged; `open`: the file
 *  shown, ticked at first). */
export const stashWithQuestion = ({ paths, staged, open }) => ({
  title: "Stash changes", confirm: "Stash", height: Math.min(640, 416 + Math.min(7, paths.length) * 26),
  input: { placeholder: "Message (optional)" },
  choices: { value: "all", options: [
    { id: "all", label: "Everything", detail: "The staged and unstaged changes" },
    { id: "staged", label: "Only the staged changes", detail: staged ? "git stash push --staged: the unstaged changes stay" : "Nothing is staged", disabled: !staged },
    { id: "files", label: "Only the selected files", detail: "Tick them below; the other files stay as they are" },
  ] },
  checks: [{ id: "untracked", label: "Include untracked files", value: true, only: ["all", "files"] },
    { id: "keep", label: "Keep staged changes", value: false, only: ["all"] },
    { id: "ignored", label: "Include ignored files", value: false, only: ["all"] }],
  files: { items: paths.map((path) => ({ path, checked: path === open })), only: ["files"] },
});

/** The dialog's answer as stashPushArgs' choices. A ticked untracked file (in `untracked`) goes
 *  whatever the box says: it was ticked. (A rename's old path is no pathspec: git matches it
 *  against nothing and fails after saving the stash; see stashui.js stashWith.) */
export function stashChoices(a, untracked = new Set()) {
  const paths = a.choice === "files" ? [...new Set(a.files)] : [];
  const withUntracked = a.choice === "files" ? Boolean(a.checks.untracked) || a.files.some((p) => untracked.has(p)) : Boolean(a.checks.untracked);
  return { message: a.text ?? "", mode: a.choice, untracked: withUntracked, paths };
}
