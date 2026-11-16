import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, statSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { MAX, KEEP, scanArgs, parseScan, infoArgs, parseInfo, changedAt, pickRepo, folderKey, rememberRepo, repoLabel } = await mod("reposcan.js");

const tmp = () => tempDir("git-enhanced-reposcan-");
const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const repo = (dir, commit = true) => {
  mkdirSync(dir, { recursive: true }); git(dir, "init", "-q");
  if (commit) { writeFileSync(join(dir, "f.txt"), "x\n"); git(dir, "add", "-A"); git(dir, "commit", "-qm", "one"); }
  return dir;
};
// `shell`: the sh find runs KEEP with ("sh" in scanArgs), to try another one (dash).
const find = (folder, depth, shell = "sh") => execFileSync("find", scanArgs(folder, depth).map((a, i, all) => (a === "sh" && all[i - 1] === "-exec" ? shell : a)), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const DASH = existsSync("/bin/dash") ? "/bin/dash" : null;

test("scanArgs looks `depth` folders down for .git entries, not into node_modules or .git, and keeps the repositories'", () => {
  assert.equal(scanArgs("/x", 0), null);
  assert.equal(scanArgs("/x", -1), null);
  assert.equal(scanArgs("/x", "junk"), null);
  assert.deepEqual(scanArgs("/a b", 1), ["/a b", "-maxdepth", "2", "(", "-name", "node_modules", "-prune", ")", "-o", "(", "-name", ".git", "-prune", "-exec", "sh", "-c", KEEP, "sh", "{}", "+", ")"]);
  assert.equal(scanArgs("/x", 2.7)[2], "3");
  // POSIX sh only: no bash or perl in it.
  assert.doesNotMatch(KEEP, /\[\[|perl|bash|\$'|local |function /);
});

test("a real scan finds nested repos and submodule-style .git files up to the depth", () => {
  const d = tmp();
  try {
    repo(join(d, "app"));
    repo(join(d, "libs", "core"));                       // two down
    repo(join(d, "deep", "a", "b"));                     // three down
    repo(join(d, "node_modules", "pkg"));                // never
    mkdirSync(join(d, "sub")); writeFileSync(join(d, "sub", ".git"), "gitdir: ../.git/modules/sub\n"); // a submodule's .git file
    mkdirSync(join(d, "wt")); writeFileSync(join(d, "wt", ".git"), "gitdir: /r/.git/worktrees/wt"); // a worktree's, no newline at its end
    mkdirSync(join(d, "plain"));
    mkdirSync(join(d, "with space", "x"), { recursive: true }); repo(join(d, "with space", "r"));
    // Not repositories: a .git folder with only GitKraken's gk/ (GitKraken leaves one behind), .git files
    // that don't start with "gitdir: " (another line first, spaces before it, empty).
    mkdirSync(join(d, "gk-only", ".git", "gk"), { recursive: true }); writeFileSync(join(d, "gk-only", ".git", "gk", "config"), "{}\n");
    mkdirSync(join(d, "notes")); writeFileSync(join(d, "notes", ".git"), "my notes about git\ngitdir: ../x\n");
    mkdirSync(join(d, "spaced")); writeFileSync(join(d, "spaced", ".git"), "  gitdir: ../x\n");
    mkdirSync(join(d, "empty")); writeFileSync(join(d, "empty", ".git"), "");
    assert.deepEqual(parseScan(find(d, 1)), [join(d, "app"), join(d, "sub"), join(d, "wt")]);
    assert.deepEqual(parseScan(find(d, 2)), [join(d, "app"), join(d, "libs", "core"), join(d, "sub"), join(d, "with space", "r"), join(d, "wt")]);
    assert.deepEqual(parseScan(find(d, 3)), [join(d, "app"), join(d, "deep", "a", "b"), join(d, "libs", "core"), join(d, "sub"), join(d, "with space", "r"), join(d, "wt")]);
    // dash runs KEEP the same.
    if (DASH) assert.deepEqual(parseScan(find(d, 3, DASH)), parseScan(find(d, 3)));
    // A .git folder with HEAD counts, whatever else it lacks.
    writeFileSync(join(d, "gk-only", ".git", "HEAD"), "ref: refs/heads/main\n");
    assert.deepEqual(parseScan(find(d, 1)), [join(d, "app"), join(d, "gk-only"), join(d, "sub"), join(d, "wt")]);
    // The folder itself a repository: its own .git is the caller's `top`, not listed again.
    repo(d);
    assert.deepEqual(parseScan(find(d, 1), d), [join(d, "app"), join(d, "gk-only"), join(d, "sub"), join(d, "wt")]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("KEEP prints only the repositories' .git entries, NUL after each, and exits 0", () => {
  const d = tmp();
  try {
    mkdirSync(join(d, "a", ".git"), { recursive: true }); writeFileSync(join(d, "a", ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(d, "b", ".git", "gk"), { recursive: true });
    mkdirSync(join(d, "c")); writeFileSync(join(d, "c", ".git"), "gitdir: ../a/.git");
    mkdirSync(join(d, "d")); writeFileSync(join(d, "d", ".git"), "nope\n");
    const paths = ["a", "b", "c", "d", "gone"].map((x) => join(d, x, ".git"));
    for (const shell of ["sh", ...(DASH ? [DASH] : [])]) {
      // The last entry not kept: still exit 0.
      const out = execFileSync(shell, ["-c", KEEP, "sh", ...paths], { encoding: "utf8" });
      assert.equal(out, `${join(d, "a", ".git")}\0${join(d, "c", ".git")}\0`, shell);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("parseScan keeps .git entries only, sorted, once each, at most max", () => {
  const out = ["/r/b/.git", "/r/a/.git", "/r/a/.git", "/r/notgit", "/r/.git", ""].join("\0");
  assert.deepEqual(parseScan(out, "/r"), ["/r/a", "/r/b"]);
  assert.deepEqual(parseScan(out, null), ["/r", "/r/a", "/r/b"]);
  assert.deepEqual(parseScan(out, null, 2), ["/r", "/r/a"]);
  assert.deepEqual(parseScan("", null), []);
  assert.deepEqual(parseScan(undefined), []);
  const many = Array.from({ length: 80 }, (_, i) => `/m/r${String(i).padStart(2, "0")}/.git`).join("\0");
  assert.equal(parseScan(many).length, MAX);
});

test("infoArgs reads each repository's branch, times and changed files in one shell", () => {
  const d = tmp();
  try {
    const a = repo(join(d, "a")), b = repo(join(d, "b q")), c = repo(join(d, "c"), false);
    writeFileSync(join(a, "new.txt"), "n\n"); writeFileSync(join(a, "f.txt"), "y\n");
    git(b, "switch", "-q", "--detach", "HEAD");
    const head = git(b, "rev-parse", "--short", "HEAD").trim();
    const args = infoArgs([a, b, c, join(d, "gone")], true);
    assert.equal(args[0], "-c"); assert.equal(args[2], "sh"); assert.deepEqual(args.slice(3), [a, b, c, join(d, "gone")]);
    const info = parseInfo(execFileSync("sh", args, { encoding: "utf8" }));
    assert.equal(info.get(a).branch, "main"); assert.equal(info.get(a).changed, 2);
    assert.ok(info.get(a).commit > 1e9 && info.get(a).index > 1e9, JSON.stringify(info.get(a)));
    assert.equal(info.get(b).branch, head); assert.equal(info.get(b).changed, 0);
    assert.equal(info.get(c).branch, "main"); assert.equal(info.get(c).commit, null);
    assert.deepEqual(info.get(join(d, "gone")), { branch: null, commit: null, index: null, changed: null });
    // Without counts: no status run, changed unknown.
    const quick = parseInfo(execFileSync("sh", infoArgs([a]), { encoding: "utf8" }));
    assert.equal(quick.get(a).changed, null); assert.equal(quick.get(a).branch, "main");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("parseInfo tolerates junk and partial output", () => {
  assert.equal(parseInfo("").size, 0);
  const m = parseInfo(["/a", "main", "100", "", "3", "/b", "dev"].join("\0"));
  assert.deepEqual(m.get("/a"), { branch: "main", commit: 100, index: null, changed: 3 });
  assert.equal(m.has("/b"), false);
  assert.equal(changedAt({ commit: 5, index: 9 }), 9);
  assert.equal(changedAt(undefined), 0);
});

test("pickRepo: remembered, then the one shown, then the folder's own, then the most recently changed", () => {
  const info = new Map([["/f/a", { commit: 10, index: 50 }], ["/f/b", { commit: 60, index: 1 }], ["/f/c", { commit: null, index: null }]]);
  const roots = ["/f/a", "/f/b", "/f/c"];
  assert.equal(pickRepo({ roots, top: "/f", info }), "/f");
  assert.equal(pickRepo({ roots, top: "/f", remembered: "/f/c", info }), "/f/c");
  assert.equal(pickRepo({ roots, top: "/f", remembered: "/gone", current: "/f/a", info }), "/f/a");
  assert.equal(pickRepo({ roots, top: null, info }), "/f/b");
  assert.equal(pickRepo({ roots, top: null, current: "/f/c", info }), "/f/c");
  assert.equal(pickRepo({ roots: ["/x", "/y"], top: null }), "/x");
  assert.equal(pickRepo({ roots: [], top: null, remembered: "/x" }), null);
  assert.equal(pickRepo({ roots: [], top: "/t", remembered: "/x" }), "/t");
});

test("pickRepo ignores a remembered repository the scan doesn't list any more", () => {
  // A pick made while a gk/-only .git was still listed as a repository; it isn't listed now.
  const d = tmp();
  try {
    const app = repo(join(d, "app")), tool = repo(join(d, "tool"));
    const gone = join(d, "gk-only-tool");
    mkdirSync(join(gone, ".git", "gk"), { recursive: true });
    const roots = parseScan(find(d, 1));
    assert.deepEqual(roots, [app, tool]);
    const info = new Map([[app, { commit: 10, index: 10 }], [tool, { commit: 20, index: 20 }]]);
    assert.equal(pickRepo({ roots, top: null, remembered: gone, info }), tool, "the most recently changed");
    assert.equal(pickRepo({ roots, top: null, remembered: gone, current: app, info }), app, "the one shown");
    assert.equal(pickRepo({ roots, top: d, remembered: gone, info }), d, "the folder's own");
    assert.equal(pickRepo({ roots, top: null, remembered: app, current: tool, info }), app, "a listed one is still taken");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("rememberRepo stores a pick per folder; the folder's own repository forgets it; the newest stay", () => {
  const k = folderKey(null, "/f");
  assert.equal(k, ":/f"); assert.equal(folderKey("vps", "/f"), "vps:/f");
  let m = rememberRepo(undefined, k, "/f/a", "/f");
  assert.deepEqual(m, { ":/f": "/f/a" });
  m = rememberRepo(m, k, "/f", "/f");
  assert.deepEqual(m, {});
  m = rememberRepo({ old: "/o" }, k, "/f/b", null);
  assert.deepEqual(Object.keys(m), ["old", ":/f"]);
  let big = {};
  for (let i = 0; i < 5; i++) big = rememberRepo(big, `k${i}`, `/r${i}`, null, 3);
  assert.deepEqual(Object.keys(big), ["k2", "k3", "k4"]);
  // Picking again moves the folder to the newest.
  big = rememberRepo(big, "k2", "/again", null, 3);
  assert.deepEqual(Object.keys(big), ["k3", "k4", "k2"]);
  assert.deepEqual(rememberRepo("junk", k, null, null), {});
});

test("repoLabel names a repository and where it is from the folder", () => {
  assert.deepEqual(repoLabel("/f/packages/api", "/f"), { name: "api", where: "packages/api" });
  assert.deepEqual(repoLabel("/f", "/f"), { name: "f", where: "." });
  assert.deepEqual(repoLabel("/elsewhere/x", "/f"), { name: "x", where: "/elsewhere/x" });
  assert.deepEqual(repoLabel("/f2/x", "/f"), { name: "x", where: "/f2/x" });
  assert.deepEqual(repoLabel("/r/a", "/r/"), { name: "a", where: "a" });
});

test("infoArgs: the index time with BSD's stat and with GNU's (no perl)", () => {
  const d = tmp();
  try {
    const a = repo(join(d, "a"));
    const want = Math.floor(statSync(join(a, ".git", "index")).mtimeMs / 1000);
    const gstat = execFileSync("sh", ["-c", "command -v gstat || true"], { encoding: "utf8" }).trim();
    const shells = [["sh", process.env.PATH]];
    if (gstat && existsSync("/bin/dash")) {
      // A PATH where stat is GNU's.
      const bin = tempDir("git-enhanced-reposcan-bin-");
      symlinkSync(gstat, join(bin, "stat"));
      shells.push(["/bin/dash", `${bin}:${process.env.PATH}`]);
    }
    for (const [shell, PATH] of shells) {
      const info = parseInfo(execFileSync(shell, infoArgs([a]), { encoding: "utf8", env: { ...process.env, PATH } }));
      assert.equal(info.get(a).index, want, `${shell} ${PATH.split(":")[0]}`);
    }
    assert.ok(!infoArgs([a])[1].includes("perl"));
  } finally { rmSync(d, { recursive: true, force: true }); }
});
