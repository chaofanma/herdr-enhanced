// What Files says about another machine before it knows what that machine has, and after a probe that
// failed. The probe (machine.js facts: uname, getconf and `command -v` for the programs some features
// need) runs once when the space's machine is first shown; while it ran, or once it had failed (a slow
// jump host timing out, the machine not up yet), capsOf took "not known" for "has nothing": the preview
// said "Saving on <machine> needs base64 or openssl there" though the machine had both, and nothing
// asked again until the panel loaded once more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, makeCx, settle, load, folder, at, draw, byId, press, text } from "./render/load.mjs";

const { default: Files } = await load("main.js");
const M = await load("machine.js");

// The probe's script (machine.js PROBE): `sh -c PROBE sh git rg …`.
const isProbe = (c, a) => c === "sh" && a[1] === M.PROBE;

async function open(dir, machine) {
  at(dir, machine);
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return { view, tree: view.role, root: () => draw(view) };
}
function reset() {
  state.shared.clear(); state.execLog.length = 0; state.overlays.length = 0; state.violations.length = 0; state.props = {};
  state.execHook = null; M.forget();
}

test("capsOf: what isn't known yet is not taken for missing; known facts say what is missing", () => {
  reset();
  const unknown = M.capsOf("sim", null);
  assert.equal(unknown.known, false, "not known yet");
  assert.equal(unknown.write, null, "saving: not known, neither yes nor no");
  const has = M.capsOf("sim", M.parseFacts("Linux\n2097152\ngit\nbase64\n"));
  assert.equal(has.known, true); assert.equal(has.write, true);
  const lacks = M.capsOf("sim", M.parseFacts("Linux\n2097152\ngit\n"));
  assert.equal(lacks.known, true); assert.equal(lacks.write, false);
  assert.equal(M.capsOf(null, null).write, true, "here: always");
});

test("preview on another machine: while the probe is out, no false reason; once it failed, it is asked again", async () => {
  reset();
  const dir = folder(["notes.md"]);
  writeFileSync(join(dir, "notes.md"), "# Notes\n");
  // The first probe fails (as one through a slow jump host timed out); the ones after work.
  let probes = 0;
  state.execHook = (c, a) => {
    if (!isProbe(c, a)) return null;
    probes++;
    return probes === 1 ? Promise.reject(new Error("timed out after 15000 ms")) : { code: 0, stdout: "Linux\n2097152\ngit\nbase64\nopenssl\n", stderr: "" };
  };
  const { root } = await open(dir, "sim");
  assert.equal(probes, 1, "probed once when the machine was first shown");
  press(byId(root(), "file-notes.md")); await settle();
  let r = root();
  // The failed probe isn't a reason to refuse: the preview doesn't say the machine lacks base64.
  const ro = byId(r, "fm-readonly");
  assert.ok(!ro || !/needs base64 or openssl/.test(String(ro.$.handlers?.tooltip?.at(-1)?.[0] ?? "")), "no false reason");
  // Asking to edit (or anything that needs the facts) probes again; this time it works.
  await settle(); r = root(); await settle(); r = root();
  assert.ok(probes >= 2, `asked again after the failure: ${probes} probes`);
  assert.ok(byId(r, "fm-edit"), "Edit is offered once the machine is known to have base64");
  assert.equal(byId(r, "fm-readonly"), null);
  state.execHook = null;
  assert.deepEqual(state.violations, []);
});

test("preview on another machine without base64 or openssl: the reason, once the probe says so", async () => {
  reset();
  const dir = folder(["notes.md"]);
  writeFileSync(join(dir, "notes.md"), "# Notes\n");
  state.execHook = (c, a) => (isProbe(c, a) ? { code: 0, stdout: "Linux\n2097152\ngit\n", stderr: "" } : null);
  const { root } = await open(dir, "sim");
  press(byId(root(), "file-notes.md")); await settle();
  const r = root(), ro = byId(r, "fm-readonly");
  assert.ok(ro, "Read-only");
  assert.match(String(ro.$.handlers?.tooltip?.at(-1)?.[0] ?? ""), /Saving on sim needs base64 or openssl there/);
  assert.equal(byId(r, "fm-edit"), null);
  state.execHook = null;
  assert.deepEqual(state.violations, []);
});

test("Replace on another machine not known yet: it waits and says so, and asks again; it never says base64 is missing", async () => {
  reset();
  const { replaceBlocked } = await load("csearch.js");
  let asked = 0;
  const tree = { on: "sim", caps: () => M.capsOf("sim"), relearn: () => { asked++; } };
  const s = { opts: {}, query: "x", files: [], busy: false };
  assert.equal(replaceBlocked(tree, s), "Finding out what sim has…");
  assert.equal(asked, 1, "the probe is asked again");
  M.forget();
  const lacks = { ...tree, caps: () => M.capsOf("sim", M.parseFacts("Linux\n2097152\ngit\n")) };
  assert.equal(replaceBlocked(lacks, s), "Replace needs base64 or openssl on sim");
  const has = { ...tree, caps: () => M.capsOf("sim", M.parseFacts("Linux\n2097152\nbase64\n")) };
  assert.equal(replaceBlocked(has, s), null);
});
