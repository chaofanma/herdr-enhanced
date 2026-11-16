// bisect.js: arguments; a real bisect run to its first bad commit (state read under sh and dash at
// each step, what each mark printed), skips and only skipped commits left, the log, reset; and
// literal outputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
import { repo, runner, SHELLS } from "./gitenv.mjs";

const B = await mod("bisect.js");
const { runPlan, parseVersion } = await mod("gitplan.js");
const H = (c) => c.repeat(40);

test("arguments and plans", () => {
  assert.deepEqual(B.startArgs({ bad: "HEAD", good: ["v1", "v2"], firstParent: true }), ["bisect", "start", "--first-parent", "HEAD", "v1", "v2", "--"]);
  assert.deepEqual(B.startArgs({ terms: { new: "broken", old: "fixed" }, noCheckout: true }), ["bisect", "start", "--no-checkout", "--term-new=broken", "--term-old=fixed", "--"]);
  assert.deepEqual(B.markArgs("skip", ["a", "b"]), ["bisect", "skip", "a", "b"]);
  assert.deepEqual(B.resetArgs(), ["bisect", "reset"]);
  assert.match(B.startPlan({ firstParent: true }, { version: parseVersion("git version 2.28.0") }).problem, /2\.29/);
  const later = B.startPlan({ good: ["v1"] });
  assert.deepEqual(later.steps.map((s) => s.args), [["bisect", "start", "--"], ["bisect", "good", "v1"]], "no bad commit yet: the good one is marked after");
  assert.match(later.confirm, /commit or stash your changes first/);
});

test("parseOutput and parseLog on literal outputs: in progress, found, only skipped left, nothing", () => {
  assert.deepEqual(B.parseOutput(`Bisecting: 3 revisions left to test after this (roughly 2 steps)\n[${H("a")}] c4\n`), { next: H("a"), found: null, candidates: [] });
  assert.deepEqual(B.parseOutput(`${H("b")} is the first bad commit\ncommit ${H("b")} (HEAD)\nAuthor: t <t@t>\n\n    c5\n`), { next: null, found: H("b"), candidates: [] });
  assert.deepEqual(B.parseOutput(`Il y a seulement des commits sautés.\n${H("c")}\n${H("d")}\nNous ne pouvons pas bissecter plus !\n`), { next: null, found: null, candidates: [H("c"), H("d")] }, "words in another language");
  assert.deepEqual(B.parseOutput(""), { next: null, found: null, candidates: [] });
  const log = [`# bad: [${H("e")}] c8`, `# good: [${H("f")}] c1`, "git bisect start 'HEAD' 'HEAD~7' '--' 'it'\\''s'", `git bisect good ${H("a")}`, `git bisect skip ${H("c")} ${H("d")}`, `# first bad commit: [${H("b")}] c5`].join("\n");
  assert.deepEqual(B.parseLog(log), {
    steps: [{ command: "start", args: ["HEAD", "HEAD~7", "--", "it's"] }, { command: "good", args: [H("a")] }, { command: "skip", args: [H("c"), H("d")] }],
    first: H("b"),
  });
  assert.deepEqual(B.parseLog(""), { steps: [], first: null });
  assert.deepEqual(B.parseState(""), { active: false, start: null, terms: { bad: "bad", good: "good" }, bad: null, good: [], skipped: [], testing: null });
});

// Eight commits; "bug.txt" appears in the fifth.
function buggy() {
  const r = repo("git-enhanced-bisect-");
  const shas = [];
  for (let i = 1; i <= 8; i++) shas.push(r.commit(`c${i}`, { "f.txt": `${i}\n`, ...(i === 5 ? { "bug.txt": "bug\n" } : {}) }));
  return { r, shas };
}

test("a real bisect from its start to the first bad commit, its state at each step, its log, and reset", async () => {
  const { r, shas } = buggy();
  await runPlan(r.h, B.startPlan({ bad: shas[7], good: [shas[0]] }));
  let state, out, steps = 0;
  for (;;) {
    for (const shell of SHELLS) {
      state = B.parseState((await runner(r.dir, shell).sh(B.BISECT_SH)).stdout);
      assert.equal(state.active, true, shell);
    }
    assert.equal(state.start, "main");
    assert.equal(state.testing, r.git("rev-parse", "HEAD").trim());
    const res = await runPlan(r.h, B.markPlan(r.exists("bug.txt") ? "bad" : "good"));
    out = B.parseOutput(res.outputs[0]);
    steps++;
    if (out.found) break;
    assert.ok(out.next, "the next commit to test");
    assert.ok(steps < 8, "it ends");
  }
  assert.equal(out.found, shas[4], "c5 is the first bad commit");
  state = B.parseState((await r.h.sh(B.BISECT_SH)).stdout);
  assert.equal(state.bad, shas[4]);
  assert.ok(state.good.includes(shas[0]));
  const log = B.parseLog((await r.h.git(["bisect", "log"])).stdout);
  assert.equal(log.first, shas[4]);
  assert.equal(log.steps[0].command, "start");
  assert.deepEqual(log.steps[0].args.slice(0, 2), [shas[7], shas[0]]);
  assert.equal(log.steps.length, 1 + steps);
  await runPlan(r.h, B.resetPlan());
  assert.equal(r.git("branch", "--show-current").trim(), "main");
  assert.equal(B.parseState((await r.h.sh(B.BISECT_SH)).stdout).active, false);
});

test("skipping: skipped commits in the state, and only skipped ones left as the candidates", async () => {
  const { r, shas } = buggy();
  await runPlan(r.h, B.startPlan({ bad: shas[4], good: [shas[2]] }));
  const testing = B.parseState((await r.h.sh(B.BISECT_SH)).stdout).testing;
  assert.equal(testing, shas[3], "c4, between c3 (good) and c5 (bad)");
  const res = await runPlan(r.h, B.markPlan("skip"));
  const out = B.parseOutput(res.outputs[0]);
  assert.deepEqual(out.candidates.sort(), [shas[3], shas[4]].sort(), "c4 or c5: git can't tell");
  assert.equal(out.found, null);
  const state = B.parseState((await r.h.sh(B.BISECT_SH)).stdout);
  assert.deepEqual(state.skipped, [shas[3]]);
  await runPlan(r.h, B.resetPlan());
});
