// Real git for the git modules' tests (conflicts, worktrees, line staging…): repositories in the temp
// folder, and git and sh run with an environment of their own, so the person's git config never
// matters: no global or system config, a test identity, an editor that fails (a step that would
// open one shows), no prompts. `exec` is Herdr's exec as node does it, and starts only git and sh.
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const { runnerOf } = await mod("gitops.js");
const home = tempDir("git-enhanced-home-");

export const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|PI_)/.test(k) && !["EDITOR", "VISUAL"].includes(k))),
  HOME: home, XDG_CONFIG_HOME: join(home, ".config"),
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
  EDITOR: "false", VISUAL: "false", TZ: "UTC",
};

/** The shells the scripts run under: the system's sh, and dash (what Linux machines have as sh). */
export const SHELLS = ["/bin/sh", ...(existsSync("/bin/dash") ? ["/bin/dash"] : [])];

/** Herdr's exec as node does it ({ code, stdout, stderr }, never throwing for a failing program),
 *  starting only git and sh (`shell` for sh); `env` replaces ENV. */
export function execWith(shell = "/bin/sh", env = ENV) {
  return (cmd, args = [], { cwd, timeout } = {}) => {
    if (cmd !== "git" && cmd !== "sh") return Promise.reject(new Error(`the tests start only git and sh, not ${cmd}`));
    return new Promise((resolve) => execFile(cmd === "sh" ? shell : "git", args, { cwd, env, encoding: "utf8", maxBuffer: 8 << 20, timeout: timeout ?? 30000 },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })));
  };
}
export const exec = execWith();

/** A runner (gitops.js runnerOf) for the repository at `dir`. */
export const runner = (dir, shell = "/bin/sh", env = ENV) => runnerOf(execWith(shell, env), dir, null);

/** git in `dir`, synchronously: its stdout, or a throw with its stderr. */
export const gitIn = (dir, ...a) => execFileSync("git", a, { cwd: dir, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 << 20 });
/** git in `dir` that may fail: { status, stdout, stderr }. */
export const tryGit = (dir, ...a) => spawnSync("git", a, { cwd: dir, env: ENV, encoding: "utf8" });

/** Helpers for the working tree at `dir`: git, files, commits and a runner. */
export function wrap(dir) {
  const git = (...a) => gitIn(dir, ...a);
  const path = (p) => join(dir, p);
  const write = (p, s) => { mkdirSync(dirname(path(p)), { recursive: true }); writeFileSync(path(p), s); };
  const remove = (p) => rmSync(path(p), { recursive: true, force: true });
  /** Writes `files` ({ path: text }, null deletes), stages everything and commits; HEAD's hash. */
  const commit = (message, files = {}) => {
    for (const [p, s] of Object.entries(files)) if (s === null) remove(p); else write(p, s);
    git("add", "-A"); git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD").trim();
  };
  return {
    dir, git, path, write, remove, commit, h: runner(dir),
    tryGit: (...a) => tryGit(dir, ...a), read: (p) => readFileSync(path(p), "utf8"), exists: (p) => existsSync(path(p)),
  };
}

/** A new repository in the temp folder, on branch main (`bare`: a bare one, as a remote). */
export function repo(prefix = "git-enhanced-b2-", { bare = false } = {}) {
  const dir = tempDir(prefix);
  gitIn(dir, "init", "-q", ...(bare ? ["--bare"] : []), "-b", "main");
  return wrap(dir);
}

/** A clone of bare repository `origin` (someone's checkout of it). */
export function cloneOf(origin, prefix = "git-enhanced-b2-clone-") {
  const base = tempDir(prefix);
  gitIn(base, "clone", "-q", origin.dir, "work");
  return wrap(join(base, "work"));
}

/** A bare repository as a remote ("origin"), and a clone of it whose first commit is pushed to
 *  main and tracked: `{ origin, ...the clone }`. */
export function withRemote(prefix = "git-enhanced-b2-") {
  const origin = repo(`${prefix}origin-`, { bare: true }), r = cloneOf(origin, prefix);
  r.git("symbolic-ref", "HEAD", "refs/heads/main");
  r.commit("one", { "f.txt": "1\n" });
  r.git("push", "-q", "-u", "origin", "main");
  return { origin, ...r };
}
