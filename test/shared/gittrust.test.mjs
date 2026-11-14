import "./no-outer-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAFE_ARGS, DIFF_SAFE, parseList, allowed, unknownKeys, CHECK_SH, parseCheck, fingerprint, checkRepo, trustKey, decide, trust } from "../../shared/gittrust.js";

// git without the person's own global and system config, so only each test repository's settings count.
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@x" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const shell = (sh) => (cmd, args, { cwd } = {}) => new Promise((resolve) => execFile(cmd === "sh" ? sh : cmd, args, { cwd, env, encoding: "utf8" },
  (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })));
const exec = shell("sh");
const base = realpathSync(mkdtempSync(join(tmpdir(), "gittrust-")));
process.on("exit", () => rmSync(base, { recursive: true, force: true }));
let n = 0;
const repo = (name = `r${++n}`) => { const d = join(base, name); mkdirSync(d, { recursive: true }); git(d, "init", "-q", "-b", "main"); return d; };
const commit = (d, file = "a.txt") => { writeFileSync(join(d, file), `${Date.now()}\n`); git(d, "add", "-A"); git(d, "commit", "-qm", "c"); };
const keys = (list) => list.map((e) => e.key).sort();

test("parseList: keys with and without values, newlines and spaces in values, subsections as written", () => {
  assert.deepEqual(parseList("core.bare\nfalse\0remote.Origin X.url\nhttps://h/r\0alias.flag\0x.msg\ntwo\nlines \0"), [
    { key: "core.bare", value: "false" }, { key: "remote.Origin X.url", value: "https://h/r" },
    { key: "alias.flag", value: null }, { key: "x.msg", value: "two\nlines " }]);
  assert.deepEqual(parseList(""), []);
  assert.deepEqual(parseList(undefined), []);
});

test("allowed: what git writes itself and plain preferences; core.fsmonitor only as a boolean", () => {
  const ok = ["core.repositoryformatversion", "core.filemode", "core.bare", "core.logallrefupdates", "core.ignorecase", "core.precomposeunicode",
    "core.hookspath", "core.worktree", "extensions.objectformat", "remote.origin.url", "remote.my.fork.fetch", "branch.main.remote",
    "branch.feature/x.merge", "branch.main.vscode-merge-base", "submodule.lib.url", "submodule.lib.active", "user.email", "pull.rebase",
    "push.default", "init.defaultbranch", "color.ui", "color.diff.meta", "status.showuntrackedfiles", "log.date", "gc.auto",
    "maintenance.strategy", "maintenance.gc.enabled", "lfs.repositoryformatversion", "diff.algorithm", "diff.colormoved"];
  for (const key of ok) assert.ok(allowed({ key, value: "1" }), key);
  for (const value of [null, "", "true", "false", "TRUE", "no", "1", "0"]) assert.ok(allowed({ key: "core.fsmonitor", value }), `fsmonitor ${value}`);
  const ask = ["core.fsmonitor", "include.path", "includeif.gitdir:/x/.path", "foo.bar", "diff.example.textconv", "filter.example.clean",
    "merge.example.driver", "submodule.lib.update", "alias.st", "core.editor", "gc.example.reflogexpire"];
  for (const key of ask) assert.ok(!allowed({ key, value: key === "core.fsmonitor" ? "/nonexistent/watch" : "x" }), key);
  assert.deepEqual(keys(unknownKeys([{ key: "core.bare", value: "false" }, { key: "foo.bar", value: "1" }])), ["foo.bar"]);
});

test("a fresh repository and a clone are read without asking", async () => {
  const d = repo();
  let c = await checkRepo({ root: d, exec });
  assert.equal(c.gitDir, join(d, ".git"));
  assert.equal(c.commonDir, join(d, ".git"));
  assert.deepEqual(c.unknown, []);
  assert.equal(decide(c, {}, trustKey(null, d)), "read");
  commit(d);
  const bare = join(base, "origin.git");
  git(base, "clone", "-q", "--bare", d, bare);
  const clone = join(base, "clone");
  git(base, "clone", "-q", bare, clone);
  git(clone, "config", "pull.rebase", "true");
  git(clone, "config", "core.hooksPath", ".husky/_");
  git(clone, "config", "core.fsmonitor", "true");
  c = await checkRepo({ root: clone, exec });
  assert.ok(keys(c.entries).includes("remote.origin.url") && keys(c.entries).includes("branch.main.merge"));
  assert.deepEqual(c.unknown, [], JSON.stringify(c.unknown));
  assert.equal(decide(c, {}, trustKey(null, clone)), "read");
});

test("a setting not on the list asks; trusting it reads; a later change asks again", async () => {
  const d = repo();
  git(d, "config", "include.path", "../elsewhere.cfg");
  git(d, "config", "foo.bar", "1");
  git(d, "config", "core.fsmonitor", "/nonexistent/watch");
  const c = await checkRepo({ root: d, exec });
  assert.deepEqual(keys(c.unknown), ["core.fsmonitor", "foo.bar", "include.path"]);
  const k = trustKey(null, d);
  assert.equal(decide(c, {}, k), "ask");
  assert.equal(decide(c, {}, k, { focused: true }), "read", "the focused terminal's repository is always read");
  const trusted = trust({}, k, c.fingerprint);
  assert.equal(decide(c, trusted, k), "read");
  git(d, "config", "foo.bar", "2");
  const changed = await checkRepo({ root: d, exec });
  assert.notEqual(changed.fingerprint, c.fingerprint);
  assert.equal(decide(changed, trusted, k), "ask", "its config changed since it was trusted");
});

test("a linked worktree's settings come from the common dir; config.worktree counts too", async () => {
  const d = repo();
  commit(d);
  const wt = join(base, "wt");
  git(d, "worktree", "add", "-q", wt, "-b", "side");
  let c = await checkRepo({ root: wt, exec });
  assert.equal(c.gitDir, join(d, ".git", "worktrees", "wt"));
  assert.equal(c.commonDir, join(d, ".git"));
  assert.deepEqual(c.unknown, []);
  git(d, "config", "extensions.worktreeConfig", "true");
  git(wt, "config", "--worktree", "foo.only", "here");
  c = await checkRepo({ root: wt, exec });
  assert.deepEqual(keys(c.unknown), ["foo.only"]);
  assert.equal(decide(c, {}, trustKey(null, wt)), "ask");
});

test("a .git file: a separate git dir and a submodule", async () => {
  const work = join(base, "work"), store = join(base, "store");
  git(base, "init", "-q", "-b", "main", "--separate-git-dir", store, work);
  let c = await checkRepo({ root: work, exec });
  assert.equal(c.gitDir, store);
  assert.deepEqual(c.unknown, []);
  const lib = repo("lib");
  commit(lib);
  const sup = repo("super");
  commit(sup);
  git(sup, "-c", "protocol.file.allow=always", "submodule", "add", "-q", lib, "sub");
  c = await checkRepo({ root: join(sup, "sub"), exec });
  assert.equal(c.gitDir, join(sup, ".git", "modules", "sub"));
  assert.ok(keys(c.entries).includes("core.worktree"));
  assert.deepEqual(c.unknown, [], JSON.stringify(c.unknown));
  c = await checkRepo({ root: sup, exec });
  assert.deepEqual(c.unknown, [], "submodule.sub.url and .active are git's own");
});

test("SAFE_ARGS win over a repository's own settings (read back with config --get)", () => {
  const d = repo();
  git(d, "config", "core.fsmonitor", "/nonexistent/watch");
  git(d, "config", "core.hooksPath", "/nonexistent/hooks");
  assert.equal(git(d, ...SAFE_ARGS, "config", "--get", "core.fsmonitor").trim(), "false");
  assert.equal(git(d, ...SAFE_ARGS, "config", "--get", "core.hooksPath").trim(), "/dev/null");
  assert.deepEqual(DIFF_SAFE, ["--no-ext-diff", "--no-textconv"]);
});

test("a folder that isn't a repository (a .git folder without HEAD), or an exec that fails: { error }, asked", async () => {
  const d = join(base, "notrepo");
  mkdirSync(join(d, ".git", "gk"), { recursive: true });
  const c = await checkRepo({ root: d, exec });
  assert.ok(c.error, JSON.stringify(c));
  assert.equal(decide(c, {}, trustKey(null, d)), "ask");
  assert.equal(decide(c, {}, trustKey(null, d), { focused: true }), "read");
  const broken = await checkRepo({ root: d, exec: async () => { throw new Error("no such machine"); } });
  assert.deepEqual(broken, { error: "no such machine" });
});

test("decide: may the panel fetch on its own? only in a focused or a trusted repository", async () => {
  const d = repo(), c = await checkRepo({ root: d, exec }), k = trustKey("dev", d);
  assert.equal(k, `dev:${d}`);
  assert.equal(trustKey(null, "/r"), ":/r");
  assert.equal(decide(c, {}, k, { fetch: true }), "ask");
  assert.equal(decide(c, {}, k, { fetch: true, focused: true }), "read");
  assert.equal(decide(c, { [k]: c.fingerprint }, k, { fetch: true }), "read");
  assert.equal(decide(null, {}, k), "ask");
});

test("fingerprint: the same settings in any order give the same string; another value another", () => {
  const a = [{ key: "a.b", value: "1" }, { key: "c.d", value: null }];
  assert.equal(fingerprint(a), fingerprint([...a].reverse()));
  assert.notEqual(fingerprint(a), fingerprint([{ key: "a.b", value: "2" }, { key: "c.d", value: null }]));
  assert.notEqual(fingerprint([{ key: "c.d", value: null }]), fingerprint([{ key: "c.d", value: "" }]));
  assert.match(fingerprint([]), /^0-[0-9a-f]{8}$/);
});

test("trust keeps the newest entries", () => {
  let t = {};
  for (let i = 0; i < 5; i++) t = trust(t, `:/r${i}`, `p${i}`, 3);
  assert.deepEqual(Object.keys(t), [":/r2", ":/r3", ":/r4"]);
  t = trust(t, ":/r2", "q", 3);
  assert.deepEqual(Object.keys(t), [":/r3", ":/r4", ":/r2"]);
  assert.deepEqual(trust(null, ":/x", "p"), { ":/x": "p" });
});

test("CHECK_SH runs under dash too (as on Debian's /bin/sh)", { skip: spawnSync("sh", ["-c", "command -v dash"]).status !== 0 && "no dash here" }, async () => {
  const d = repo();
  const c = await checkRepo({ root: d, exec: shell("dash") });
  assert.equal(c.gitDir, join(d, ".git"));
  assert.deepEqual(parseCheck("/g\0/c\0a.b\n1\0").entries, [{ key: "a.b", value: "1" }]);
  assert.ok(CHECK_SH.includes("rev-parse --git-common-dir"));
});
