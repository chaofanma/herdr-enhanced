// gitplan.js: plans, git's versions, C-quoted names, and runPlan against real repositories.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { repo, runner, ENV, gitIn } from "./gitenv.mjs";

const P = await mod("gitplan.js");

test("git's version: parsed from what platforms print, compared, and what each feature needs", () => {
  assert.deepEqual(P.parseVersion("git version 2.39.3 (Apple Git-145)\n"), { major: 2, minor: 39, patch: 3 });
  assert.deepEqual(P.parseVersion("git version 2.45.1.windows.1"), { major: 2, minor: 45, patch: 1 });
  assert.deepEqual(P.parseVersion("git version 2.30"), { major: 2, minor: 30, patch: 0 });
  assert.equal(P.parseVersion(""), null);
  assert.equal(P.parseVersion("sh: git: not found"), null);
  const v = P.parseVersion("git version 2.30.2");
  assert.equal(P.atLeast(v, "2.30"), true);
  assert.equal(P.atLeast(v, "2.30.3"), false);
  assert.equal(P.atLeast(v, "2.4"), true, "2.30 is after 2.4");
  assert.equal(P.atLeast(P.parseVersion("git version 3.0.0"), "2.99"), true);
  assert.equal(P.atLeast(null, "1.0"), false, "an unknown version has nothing");
  assert.equal(P.has(v, "force-if-includes"), true);
  assert.equal(P.has(v, "worktree-list-z"), false);
  assert.equal(P.has(P.parseVersion("git version 2.36.0"), "worktree-list-z"), true);
  assert.equal(P.has(v, "no-such-feature"), false);
  for (const [name, since] of Object.entries(P.SINCE)) assert.match(since, /^2\.\d+$/, name);
  // The git these tests run has every feature here.
  const here = P.parseVersion(gitIn(".", "version"));
  assert.ok(here, "git version parses");
});

test("C-quoted names: git's own quoting read back, and quoted the way git apply reads it", () => {
  assert.equal(P.unquoteC("plain name.txt"), "plain name.txt");
  assert.equal(P.unquoteC('"tab\\there"'), "tab\there");
  assert.equal(P.unquoteC('"a\\"b\\\\c\\nd"'), 'a"b\\c\nd');
  assert.equal(P.unquoteC('"\\303\\244.txt"'), "ä.txt", "octal UTF-8 bytes");
  assert.equal(P.unquoteC('"\\360\\237\\230\\200"'), "😀");
  assert.equal(P.unquoteC('"mixed ä and \\303\\266"'), "mixed ä and ö", "raw UTF-8 (quotepath off) and octal together");
  assert.equal(P.unquoteC('"\\377"'), "\ufffd", "a byte that isn't UTF-8");
  assert.equal(P.unquoteC('"'), '"');
  assert.equal(P.quoteC("x y.txt", "a/"), "a/x y.txt");
  assert.equal(P.quoteC("ä.txt", "b/"), "b/ä.txt", "UTF-8 stays as it is");
  assert.equal(P.quoteC('we\tird"\\', "a/"), '"a/we\\tird\\"\\\\"');
  assert.equal(P.quoteC("bell\x07\x01"), '"bell\\a\\001"');
  for (const name of ["x", "a b", 'q"uote', "back\\slash", "new\nline", "tab\t", "ä😀"]) assert.equal(P.unquoteC(P.quoteC(name)), name, name);
  // What git prints for a name with a tab, a quote and a UTF-8 letter (ls-files without -z).
  const r = repo();
  const name = 'we\tird"ä.txt';
  r.write(name, "x\n"); r.git("add", "-A");
  for (const q of ["true", "false"]) assert.equal(P.unquoteC(r.git("-c", `core.quotepath=${q}`, "ls-files").replace(/\n$/, "")), name, `core.quotepath=${q}`);
  assert.deepEqual(P.nulFields("a\0b\0"), ["a", "b"]);
  assert.deepEqual(P.nulFields(""), []);
  assert.deepEqual(P.nulFields("a\0\0b"), ["a", "", "b"]);
  assert.deepEqual(P.records("\x1ehead\nabc\n\x1eempty\n\x1elines\na\nb\n"), { head: "abc\n", empty: "", lines: "a\nb\n" });
  assert.deepEqual(P.records(""), {});
});

test("plans and steps", () => {
  assert.equal(P.failureWords({ code: 1, stdout: "", stderr: "To /x.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to '/x.git'\nhint: Updates were rejected\n" }),
    "! [rejected] main -> main (fetch first)\nerror: failed to push some refs to '/x.git'");
  assert.equal(P.failureWords({ code: 128, stdout: "", stderr: "fatal: not a git repository\n" }), "fatal: not a git repository");
  assert.deepEqual(P.plan([P.step(["fetch"], "Fetch", { net: true }), null, false]), { steps: [{ args: ["fetch"], why: "Fetch", net: true }], danger: false });
  assert.deepEqual(P.plan([], { confirm: "Sure?", danger: 1 }), { steps: [], confirm: "Sure?", danger: true });
  assert.deepEqual(P.problem("No upstream"), { steps: [], danger: false, problem: "No upstream" });
  assert.deepEqual(P.NO_EDITOR, ["-c", "core.editor=true"]);
});

test("runPlan: git and sh steps in order, outputs kept, exit codes that are fine, a refusal stops the rest", async () => {
  const r = repo();
  r.commit("one", { "a.txt": "a\n" });
  const out = await P.runPlan(r.h, P.plan([
    P.step(["rev-parse", "--abbrev-ref", "HEAD"], "Branch"),
    { script: 'printf "%s|" "$@"', args: ["x y", "z"], why: "A script" },
    P.step(["config", "--unset", "no.such"], "Nothing to unset", { ok: [5] }),
  ]));
  assert.deepEqual(out, { done: 3, stopped: null, outputs: ["main\n", "x y|z|", ""] });
  const seen = [];
  await assert.rejects(P.runPlan(r.h, P.plan([P.step(["switch", "no-such-branch"], "Switch"), P.step(["tag", "never"], "Never runs")]), { onStep: (i) => seen.push(i) }), /no-such-branch|invalid reference/);
  assert.deepEqual(seen, [0], "the step after a refusal doesn't start");
  assert.equal(r.tryGit("rev-parse", "-q", "--verify", "refs/tags/never").status, 1);
  await assert.rejects(P.runPlan(r.h, P.problem("Fetch first")), /Fetch first/);
  await assert.rejects(P.runPlan(r.h, { steps: [{ apply: ["--cached"], why: "x" }], patch: "" }), /No way to apply/);
  await assert.rejects(P.runPlan(r.h, { steps: [{ body: "true", why: "x" }], patch: "" }), /No way to send/);
  const applied = [];
  await P.runPlan(r.h, { steps: [{ apply: ["--check"], why: "Check" }], patch: "PATCH", danger: false }, { apply: async (p, f) => { applied.push([p, f]); return "ok"; } });
  assert.deepEqual(applied, [["PATCH", ["--check"]]]);
});

test("runPlan: a step that stops on conflicts is a stop, not an error; editor steps open none even with GIT_EDITOR set", async () => {
  const r = repo();
  r.commit("one", { "f.txt": "1\n" });
  r.git("switch", "-q", "-c", "side"); r.commit("side", { "f.txt": "side\n" });
  r.git("switch", "-q", "main"); r.commit("main", { "f.txt": "main\n" });
  const merge = P.plan([P.step([...P.NO_EDITOR, "merge", "--no-edit", "side"], "Merge", { stops: true, editor: true }), P.step(["tag", "after"], "Never runs")]);
  const res = await P.runPlan(r.h, merge);
  assert.equal(res.done, 0);
  assert.match(res.stopped, /CONFLICT/);
  assert.equal(r.tryGit("rev-parse", "-q", "--verify", "refs/tags/after").status, 1);
  r.write("f.txt", "both\n"); r.git("add", "f.txt");
  // The person's GIT_EDITOR (here one that fails) would win over -c core.editor=true; GIT_SH unsets it.
  const h = runner(r.dir, "/bin/sh", { ...ENV, GIT_EDITOR: "false", GIT_SEQUENCE_EDITOR: "false" });
  const plain = await h.git([...P.NO_EDITOR, "merge", "--continue"]);
  assert.notEqual(plain.code, 0, "GIT_EDITOR=false wins over core.editor");
  await P.runPlan(h, P.plan([P.step([...P.NO_EDITOR, "merge", "--continue"], "Continue", { editor: true })]));
  assert.equal(r.git("log", "-1", "--format=%P").trim().split(" ").length, 2, "the merge commit was made");
});
