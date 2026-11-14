// gittrust.js: whether the panel may read a git repository it found by scanning, without asking first.
// Herdr Enhanced (Files Enhanced and Git Enhanced carry byte-identical copies).
//
// The panel scans the folders below the shown one for repositories and reads them on its own (status,
// diffs, logs). A repository's own git config can change what git does while it reads, so a scanned
// repository is read without asking only when every setting in its own config (config, and
// config.worktree) is on the short list below: settings git writes itself (init, clone, branch,
// remote, submodule, worktree) and preferences that only change how git stores or shows things.
// Anything else, a setting this list doesn't know included, means "ask": the repository is listed
// with "Read it", and a click trusts that config (it asks again once the config changes). The
// repository of the focused terminal's folder is always read: the person works there.
//
// git parses the files itself (`git config --file <file> --null --list`). With --file it doesn't
// follow includes, so an include is a setting of its own (not on the list). Every git call the panel
// makes on its own also gets SAFE_ARGS, and every diff it makes on its own DIFF_SAFE.
// No imports: the caller passes exec (Herdr's, or a test's).

/** For every git call the panel makes on its own (never for one the person asked for, such as Commit). */
export const SAFE_ARGS = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
/** For every diff the panel makes on its own (counts, file lists). */
export const DIFF_SAFE = ["--no-ext-diff", "--no-textconv"];
/** For a sh script the panel runs on its own: put first, its `git` gets SAFE_ARGS. A git started
 *  another way (`exec git`, `env … git`) doesn't: write SAFE_ARGS out there. */
export const SAFE_GIT_SH = `git() { command git ${SAFE_ARGS.join(" ")} "$@"; }\n`;

const BOOL = /^(true|false|yes|no|on|off|1|0)$/i;
// Keys as `git config --list` prints them: section and name in lower case, a subsection as written.
const ALLOWED = [
  /^core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|autocrlf|eol|safecrlf|symlinks|quotepath|longpaths|untrackedcache|splitindex|commitgraph|multipackindex|compression|loosecompression|abbrev|checkstat|trustctime|preloadindex|sparsecheckout|sparsecheckoutcone|whitespace|warnambiguousrefs|bigfilethreshold|deltabasecachelimit|packedgitlimit|packedgitwindowsize|fscache|protecthfs|protectntfs|excludesfile|attributesfile|worktree|hookspath)$/,
  /^extensions\.(objectformat|worktreeconfig|refstorage|noop)$/,
  /^remote\..+\.(url|pushurl|fetch|push|tagopt|prune|prunetags|mirror|skipdefaultupdate|skipfetchall|followremotehead)$/,
  /^branch\..+\.[^.]+$/, // git reads remote, merge, rebase, pushRemote and description; tools add their own (VS Code's vscode-merge-base)
  /^branch\.(autosetupmerge|autosetuprebase|sort)$/,
  /^submodule\..+\.(url|active|branch|fetchrecursesubmodules|ignore|shallow)$/,
  /^user\.(name|email|signingkey|useconfigonly)$/,
  /^(pull\.(rebase|ff)|push\.(default|autosetupremote|followtags)|fetch\.(prune|prunetags|writecommitgraph|parallel)|init\.defaultbranch)$/,
  /^(rebase\.(autosquash|autostash|updaterefs|abbreviatecommands|stat)|merge\.(ff|conflictstyle|log|stat|autostash)|rerere\.(enabled|autoupdate))$/,
  /^(commit\.(gpgsign|verbose|cleanup|status)|tag\.(gpgsign|sort)|lfs\.repositoryformatversion)$/,
  /^(status|log|gc|pack|index|feature|i18n)\.[a-z0-9]+$/,
  /^maintenance\.[a-z0-9-]+(\.[a-z0-9]+)?$/,
  /^(color|column|advice|gui)\..+$/,
  /^diff\.(renames|renamelimit|algorithm|colormoved|colormovedws|mnemonicprefix|noprefix|indentheuristic|context|interhunkcontext|ignoresubmodules|submodule|relative|statgraphwidth|suppressblankempty|wordregex|dirstat|orderfile)$/,
];

/** `git config --null --list`'s entries: [{ key, value }], value null for a key written without one. */
export function parseList(stdout) {
  return String(stdout ?? "").split("\0").filter((s) => s.length).map((s) => {
    const at = s.indexOf("\n");
    return at < 0 ? { key: s, value: null } : { key: s.slice(0, at), value: s.slice(at + 1) };
  });
}

/** Whether a setting is on the list (core.fsmonitor only as a boolean: git's own daemon). */
export function allowed({ key, value }) {
  if (key === "core.fsmonitor") return value === null || value === "" || BOOL.test(value);
  return ALLOWED.some((re) => re.test(key));
}

/** The settings that are not on the list: any of them means "ask". */
export const unknownKeys = (entries) => entries.filter((e) => !allowed(e));

/** sh's script (cwd: the repository): the git dir and the common dir, absolute, then the settings
 *  of the common dir's config and the git dir's config.worktree, NUL separated. */
export const CHECK_SH = [
  "g=$(git -c core.fsmonitor=false rev-parse --absolute-git-dir) || exit 1",
  "c=$(git -c core.fsmonitor=false rev-parse --git-common-dir) || exit 1",
  'case "$c" in /*) ;; *) c=$(cd "$c" && pwd -P) || exit 1 ;; esac',
  "printf '%s\\0%s\\0' \"$g\" \"$c\"",
  'git config --file "$c/config" --null --list 2>/dev/null',
  '[ -f "$g/config.worktree" ] && git config --file "$g/config.worktree" --null --list 2>/dev/null',
  "exit 0",
].join("\n");

/** What CHECK_SH printed: { gitDir, commonDir, entries }. */
export function parseCheck(stdout) {
  const [gitDir = "", commonDir = "", ...rest] = String(stdout ?? "").split("\0");
  return { gitDir, commonDir, entries: parseList(rest.join("\0")) };
}

/** A short stable string for a set of settings: a change gives another one. Not a defence against
 *  someone who wants a collision; it only notices a change. */
export function fingerprint(entries) {
  const text = entries.map((e) => (e.value === null ? e.key : `${e.key}\n${e.value}`)).sort().join("\0");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${entries.length}-${h.toString(16).padStart(8, "0")}`;
}

/** The repository's settings, checked: { gitDir, commonDir, entries, unknown, fingerprint }, or
 *  { error } when git can't read it (never throws). */
export async function checkRepo({ root, on = null, exec }) {
  let r;
  try { r = await exec("sh", ["-c", CHECK_SH, "sh"], { cwd: root, on }); }
  catch (e) { return { error: String(e?.message ?? e) }; }
  const first = (s) => String(s ?? "").trim().split("\n")[0];
  if (!r || r.code !== 0) return { error: first(r?.stderr) || "git could not read this repository" };
  const { gitDir, commonDir, entries } = parseCheck(r.stdout);
  if (!gitDir) return { error: "git could not read this repository" };
  return { gitDir, commonDir, entries, unknown: unknownKeys(entries), fingerprint: fingerprint(entries) };
}

/** The key a trust is kept under in shared("herdr-enhanced.trusted"): machine (empty here) and path. */
export const trustKey = (machine, repoPath) => `${machine ?? ""}:${repoPath}`;

/** "read" or "ask" for a checked repository (`check`: checkRepo's result; `trusted`: key → fingerprint).
 *  `focused`: the focused terminal's repository, always read. `fetch`: may the panel fetch on its own:
 *  only in a focused or trusted one. */
export function decide(check, trusted, key, { focused = false, fetch = false } = {}) {
  if (focused) return "read";
  if (!check || check.error) return "ask";
  if (trusted && typeof trusted === "object" && trusted[key] === check.fingerprint) return "read";
  if (fetch) return "ask";
  return check.unknown.length ? "ask" : "read";
}

/** The trusted map after trusting `key` with this fingerprint (at most `max` kept, newest last). */
export function trust(trusted, key, print, max = 500) {
  const next = { ...(trusted && typeof trusted === "object" && !Array.isArray(trusted) ? trusted : {}) };
  delete next[key];
  next[key] = print;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete next[k];
  return next;
}
