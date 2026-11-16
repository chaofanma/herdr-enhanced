// What the pages read on their own (repotrust.js, gittrust.js): a repository found below the shown
// folder whose own git config has a setting beyond the usual ones isn't read until Read it; the
// trust is kept by its config's fingerprint, so a change to the config asks again; the folder's own
// repository is always read; every read carries SAFE_ARGS (no fsmonitor, no hooks), a script
// SAFE_GIT_SH; the automatic fetch runs only in the folder's own repository or a trusted one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, textOf, press, handler, settle, makeCx, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const { SAFE_ARGS, SAFE_GIT_SH } = await load("gittrust.js");
const { TRUSTED, NOT_READ, checks } = await load("repotrust.js");
const { KEYS } = await load("panelsettings.js");

// A folder with two repositories below it, each with a.txt changed: "plain" (the usual settings) and
// "odd" (one more: a diff driver's textconv, a program git would run on a diff).
function folder() {
  const dir = tempDir("git-enhanced-trust-");
  const make = (name, extra) => {
    const d = join(dir, name), git = (...a) => execFileSync("git", a, { cwd: d, encoding: "utf8" });
    mkdirSync(d); git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t"); git("config", "core.hooksPath", "/dev/null");
    writeFileSync(join(d, "a.txt"), "one\n"); git("add", "-A"); git("commit", "-qm", "first");
    writeFileSync(join(d, "a.txt"), "two\n");
    for (const [k, v] of extra) git("config", k, v);
    return { dir: d, git };
  };
  return { dir, plain: make("plain", []), odd: make("odd", [["diff.secret.textconv", "cat"]]) };
}
const tipOf = (node) => node?.handlers?.tooltip?.at(-1)?.[0];
// Every exec in `dir` since `from`, but the trust check's own script (it reads the config only).
const ranIn = (dir, from = 0) => state.execLog.slice(from).filter(([c, a, cwd]) => cwd === dir && !(c === "sh" && /config --file/.test(a[1] ?? "")));
const safe = ([c, a]) => (c === "git" ? SAFE_ARGS.every((x, i) => a[i] === x) : c === "sh" ? String(a[1]).startsWith(SAFE_GIT_SH) : true);

test("Changes: a repository below the folder with a setting beyond the usual ones isn't read until Read it; a changed config asks again", async () => {
  checks.clear(); state.shared.delete(TRUSTED);
  const f = folder();
  const view = await mount(f.dir, { palette: "theme" }), page = view.part;
  assert.equal(page.root, f.plain.dir, "the one read is shown first (the other has no times to compare)");
  assert.ok(page.entries.some((e) => e.path === "a.txt"));
  // The switcher: "odd" says it isn't read.
  page.repoSet.openList(true, makeCx()); await settle();
  let tree = await draw(view);
  assert.match(textOf(byId(tree, "repo-0")), /odd.*not read/s);
  assert.doesNotMatch(textOf(byId(tree, "repo-1")), /not read/);
  // Picking it: nothing of it is read, the page says why and offers Read it.
  const before = state.execLog.length;
  press(byId(tree, "repo-0")); await settle();
  tree = await draw(view);
  assert.equal(page.root, null);
  assert.equal(page.unread?.root, f.odd.dir);
  const bar = byId(tree, "changes-not-read");
  assert.ok(bar && textOf(bar).includes(NOT_READ), "the bar");
  assert.match(tipOf(bar), /diff\.secret\.textconv/, "its tooltip names the setting");
  assert.deepEqual(page.entries, []); assert.equal(page.diff.rows.length, 0);
  assert.deepEqual(ranIn(f.odd.dir, before), [], "no git ran there but the check");
  assert.ok(byId(tree, "repo-box"), "the switcher stays, for another repository");
  // Read it: trusted (by its config's fingerprint), read with SAFE_ARGS.
  const mark = state.execLog.length;
  press(byId(tree, "changes-read-it")); await settle();
  const trusted = state.shared.get(TRUSTED);
  assert.deepEqual(Object.keys(trusted), [`:${f.odd.dir}`]);
  assert.equal(trusted[`:${f.odd.dir}`], checks.get(f.odd.dir).fingerprint);
  tree = await draw(view);
  assert.equal(page.root, f.odd.dir); assert.equal(page.unread, null);
  assert.ok(!byId(tree, "changes-not-read"));
  assert.ok(page.entries.some((e) => e.path === "a.txt") && page.diff.rows.length > 0, "its changes and the diff");
  const ran = ranIn(f.odd.dir, mark);
  assert.ok(ran.some(([c]) => c === "git") && ran.some(([c]) => c === "sh"));
  assert.deepEqual(ran.filter((x) => !safe(x)), [], "every git with SAFE_ARGS, every script with SAFE_GIT_SH");
  // Its config changes: asked again (once the check is looked at again: 30 s, here at once).
  f.odd.git("config", "core.sshCommand", "ssh -v");
  checks.clear();
  page.refresh(makeCx("async")); await settle();
  tree = await draw(view);
  assert.equal(page.unread?.root, f.odd.dir, "asks again");
  assert.match(tipOf(byId(tree, "changes-not-read")), /core\.sshcommand/i);
  assert.deepEqual(state.violations, []);
});

test("Changes: the folder's own repository is always read, whatever its config; it fetches by itself, one below only once trusted", async () => {
  checks.clear(); state.shared.delete(TRUSTED);
  const f = folder();
  // The folder is "odd" itself: read, its reads with SAFE_ARGS.
  const view = await mount(f.odd.dir, { palette: "theme" }), page = view.part;
  assert.equal(page.root, f.odd.dir); assert.equal(page.unread, null);
  assert.ok(page.entries.some((e) => e.path === "a.txt"));
  // The automatic fetch: the folder's own repository fetches; a remote makes it due.
  f.odd.git("remote", "add", "origin", f.plain.dir);
  const settings = { ...(state.shared.get(KEYS.changes) ?? {}) };
  state.shared.set(KEYS.changes, { ...settings, autoFetch: 1 });
  try {
    page.refresh(makeCx("async")); await settle();
    page.fetched.clear();
    let mark = state.execLog.length;
    page.autoFetch(makeCx("async")); await settle();
    const fetched = (from) => state.execLog.slice(from).filter(([c, a]) => c === "sh" && /git fetch --prune --quiet/.test(a[1] ?? ""));
    assert.equal(fetched(mark).length, 1, "the folder's own repository fetches");
    assert.ok(fetched(mark)[0][1][1].startsWith(SAFE_GIT_SH), "with SAFE_ARGS");
    // From the folder above, "odd" below it: usual settings or not, it fetches only once trusted.
    const above = await mount(f.dir, { palette: "theme" }), p2 = above.part;
    p2.repoSet.choose(f.plain.dir); p2.refresh(makeCx("async")); await settle();
    f.plain.git("remote", "add", "origin", f.odd.dir);
    p2.refresh(makeCx("async")); await settle();
    assert.equal(p2.root, f.plain.dir); assert.ok(p2.facts?.remote, "plain has a remote now");
    p2.fetched.clear(); mark = state.execLog.length;
    p2.autoFetch(makeCx("async")); await settle();
    assert.equal(fetched(mark).length, 0, "not trusted: no fetch of its own");
    state.shared.set(TRUSTED, { [`:${f.plain.dir}`]: checks.get(f.plain.dir).fingerprint });
    p2.fetched.clear(); mark = state.execLog.length;
    p2.autoFetch(makeCx("async")); await settle();
    assert.equal(fetched(mark).length, 1, "trusted: it fetches");
  } finally { state.shared.set(KEYS.changes, settings); state.shared.delete(TRUSTED); }
  assert.deepEqual(state.violations, []);
});

test("History: a repository that isn't read shows why and Read it, and no commits", async () => {
  checks.clear(); state.shared.delete(TRUSTED);
  const f = folder();
  const view = await mount(f.dir, { palette: "theme", view: "history" }), h = view.part.history;
  assert.equal(h.root, f.plain.dir);
  view.part.repos.choose(f.odd.dir); h.reload(makeCx("async")); await settle();
  let tree = await draw(view);
  assert.equal(h.unread?.root, f.odd.dir); assert.deepEqual(h.commits, []);
  assert.ok(textOf(byId(tree, "history-not-read")).includes(NOT_READ));
  assert.ok(byId(tree, "history-repo-box"), "the switcher stays");
  assert.ok(!/Reading the history/.test(textOf(byId(tree, "history-list-area"))));
  press(byId(tree, "history-read-it")); await settle();
  tree = await draw(view);
  assert.equal(h.root, f.odd.dir); assert.equal(h.commits.length, 1);
  assert.ok(!byId(tree, "history-not-read"));
  assert.deepEqual(state.violations, []);
  state.shared.delete(TRUSTED);
});

test("the turn recorder's snapshot: its git with SAFE_ARGS, also where it runs git through env", async () => {
  const { snapshotArgs, SNAPSHOT } = await load("turns.js");
  assert.match(SNAPSHOT, /env GIT_INDEX_FILE="\$idx" git -c core\.fsmonitor=false -c core\.hooksPath=\/dev\/null -c core\.ignorestat=false/);
  assert.match(SNAPSHOT, /env GIT_INDEX_FILE="\$idx" git -c core\.fsmonitor=false -c core\.hooksPath=\/dev\/null -c core\.splitIndex=false write-tree/);
  assert.equal(snapshotArgs()[1], SNAPSHOT);
  // A hook a repository's own .git/hooks has never runs from the recorder (reference-transaction
  // would on update-ref).
  // Without the person's own git settings (a global core.hooksPath would hide .git/hooks).
  const f = folder(), flag = join(f.dir, "hook-ran"), env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  f.plain.git("config", "--unset", "core.hooksPath");
  writeFileSync(join(f.plain.dir, ".git/hooks/reference-transaction"), `#!/bin/sh\ntouch "${flag}"\n`, { mode: 0o755 });
  const r = execFileSync("sh", ["-c", SAFE_GIT_SH + SNAPSHOT, "sh", "commit", "refs/test/turn", "t", "10"], { cwd: f.plain.dir, encoding: "utf8", env });
  assert.match(r, /^commit [0-9a-f]{40}/m);
  assert.equal(execFileSync("git", ["rev-parse", "refs/test/turn"], { cwd: f.plain.dir, encoding: "utf8", env }).trim(), r.trim().split(" ")[1]);
  assert.throws(() => execFileSync("test", ["-e", flag]), "the hook didn't run");
  execFileSync("git", ["update-ref", "refs/test/other", "HEAD"], { cwd: f.plain.dir, env });
  assert.doesNotThrow(() => execFileSync("test", ["-e", flag]), "it does without SAFE_ARGS");
});
