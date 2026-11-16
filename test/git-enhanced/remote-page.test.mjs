// A repository on another machine (the stubs run its git and sh here, as if there; every call must
// say `on`): the list, a hunk staged through base64 (FILES_SH), the remote's state polled instead of
// watched; on a machine with neither base64 nor openssl the hunk buttons hide, and a file still
// stages (git add needs no bytes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, lists, renderRows, texts, settle, makeCx, load } from "./render/load.mjs";

const machine = await load("machine.js");
const { PROBE, STATE_SH } = await load("scripts.js");
const { SAFE_GIT_SH } = await load("gittrust.js");
function probeAnswers(tools) {
  machine.forget();
  state.execHook = (cmd, args, _cwd, on) => {
    if (cmd === "sh" && args[1] === PROBE) return { code: 0, stdout: `Linux\n2097152\n${tools.join("\n")}\n`, stderr: "" };
    return null;
  };
}
function setup() {
  const r = repo(({ write, git }) => { write("a.txt", "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  r.write("a.txt", "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n");
  return r;
}

test("on another machine: hunks staged there through base64; its state polled, not watched", async () => {
  const r = setup();
  probeAnswers(["git", "base64"]);
  const watchedBefore = state.watched.length;
  const view = await mount(r.dir, { palette: "theme" }, "vps"), page = view.part;
  assert.equal(page.on, "vps"); assert.equal(page.root, r.dir);
  assert.deepEqual(page.caps, { git: true, put: true, putMax: page.caps.putMax });
  assert.ok(page.caps.putMax > 0);
  if (page.open?.path !== "a.txt") { page.pick("a.txt", "unstaged", makeCx()); await settle(); }
  assert.deepEqual(page.hunkActions().map((a) => a.id), ["stage", "revert"]);
  assert.equal(page.diff.hunks.length, 2);
  const ran = state.execLog.length;
  page.hunk("stage", page.diff.hunks[0], makeCx()); await settle();
  assert.match(r.git("diff", "--cached"), /^\+ONE$/m);
  assert.doesNotMatch(r.git("diff", "--cached"), /TEN/);
  const calls = state.execLog.slice(ran).filter(([c]) => c === "git" || c === "sh");
  assert.ok(calls.length > 0 && calls.every(([, , , on]) => on === "vps"), "everything ran on vps");
  assert.ok(calls.some(([c, a]) => c === "sh" && /base64 -d|base64 -D|openssl base64/.test(a[1] ?? "")), "the patch went as base64");
  assert.equal(state.watched.length, watchedBefore, "no watchFolder for another machine");
  page.poll(makeCx()); await settle();
  assert.ok(state.execLog.some(([c, a, , on]) => c === "sh" && a[1] === SAFE_GIT_SH + STATE_SH && on === "vps"), "polled there, its git with SAFE_ARGS");
  state.execHook = null; machine.forget();
  assert.deepEqual(state.violations, []);
});

test("a machine with neither base64 nor openssl: no hunk buttons; a file still stages", async () => {
  const r = setup();
  probeAnswers(["git"]);
  const view = await mount(r.dir, { palette: "theme" }, "bare"), page = view.part;
  assert.equal(page.caps.put, false);
  if (page.open?.path !== "a.txt") { page.pick("a.txt", "unstaged", makeCx()); await settle(); }
  assert.deepEqual(page.hunkActions(), []);
  const rows = renderRows(lists(await draw(view)).find((l) => l.listId === "changes-diff"));
  assert.ok(!rows.some((x) => texts(x).includes("Stage") || texts(x).includes("Revert…")), "no buttons on the @@ rows");
  page.stageRow("a.txt", "unstaged", makeCx()); await settle();
  assert.match(r.git("diff", "--cached", "--name-only"), /a\.txt/);
  // Here (no machine) nothing is asked: the buttons are there.
  state.execHook = null; machine.forget();
  const here = await mount(r.dir, { palette: "theme" });
  assert.equal(here.part.caps, null);
  r.git("reset", "-q");
  here.part.refresh(makeCx("async")); await settle();
  if (here.part.open?.path !== "a.txt") { here.part.pick("a.txt", "unstaged", makeCx()); await settle(); }
  assert.deepEqual(here.part.hunkActions().map((a) => a.id), ["stage", "revert"]);
  assert.deepEqual(state.violations, []);
});

test("the pen for a repository on another machine: the diff is read there, the agent runs here", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { REPO } = await import("./mod.mjs");
  const OK = readFileSync(join(REPO, "test/git-enhanced/fixtures/pi-ok.jsonl"), "utf8");
  const r = setup();
  r.git("add", "a.txt");
  machine.forget();
  const pen = [];
  state.execHook = (cmd, args, _cwd, on) => {
    if (cmd === "sh" && args[1] === PROBE) return { code: 0, stdout: `Linux\n2097152\ngit\nbase64\n${on ? "" : "pi\n"}`, stderr: "" };
    if (cmd === "sh" && /-pen\.XXXXXX/.test(args[1])) { pen.push(on); return { code: 0, stdout: OK, stderr: "" }; }
    return null;
  };
  const view = await mount(r.dir, { palette: "theme" }, "vps"), page = view.part;
  const ran = state.execLog.length;
  page.pen(makeCx()); await settle();
  assert.equal(page.input.value(), "Add a todo item removal function");
  assert.deepEqual(pen, [null], "the agent ran here (pi is installed here, not on vps)");
  const reads = state.execLog.slice(ran).filter(([c, a]) => c === "git" && a[0] === "diff");
  assert.ok(reads.length && reads.every(([, , , on]) => on === "vps"), "the diff was read on vps");
  state.execHook = null; machine.forget();
  assert.deepEqual(state.violations, []);
});
