// Files' header on another machine: the folder's name and the machine's both share the row, the
// buttons fit. The machine's chip had a size of its own (flex_none), so with a long machine name
// (build-runner-eu-west-17) a narrow panel gave all its room to the chip and cut the folder's name
// to its first letter ("l…" for lantern).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { state, makeCx, settle, load, folder, at, draw, byId } from "./render/load.mjs";

const { default: Files } = await load("main.js");
const M = await load("machine.js");

async function open(dir, machine) {
  at(dir, machine);
  const view = new Files();
  view.init({}, makeCx());
  await settle(); draw(view); await settle();
  return draw(view);
}
// The calls of the element, by name: [args…] of the last one.
const call = (n, m) => n.$.calls.findLast(([c]) => c === m)?.[1];
const has = (n, m) => n.$.calls.some(([c]) => c === m);

test("header on another machine: the machine's chip gives way too, and the folder's name keeps room", async () => {
  state.shared.clear(); state.execLog.length = 0; state.overlays.length = 0; state.violations.length = 0; state.props = {};
  M.forget();
  const base = folder(["x.txt"]), dir = join(base, "lantern");
  mkdirSync(dir); mkdirSync(join(dir, "src"));
  const root = await open(dir, "build-runner-eu-west-17");
  const head = byId(root, "fm-root");
  assert.ok(head, "the header's folder button");
  const [name, chip] = head.$.children.filter((c) => c?.$?.kind === "div");
  assert.deepEqual(name.$.children, ["lantern"]);
  assert.deepEqual(chip.$.children, ["build-runner-eu-west-17"]);
  // The chip: no size of its own, it gives way (truncates) after the name has its least room.
  assert.ok(!has(chip, "flex_none"), "the chip doesn't keep its whole width");
  assert.ok(has(chip, "truncate"), "a long machine name ends with …");
  assert.ok(call(chip, "min_w")?.[0] > 0, "the chip keeps a little of itself");
  // The name keeps room for a few letters before the chip gives way.
  assert.ok(call(name, "min_w")?.[0] >= 40, `the folder's name keeps at least 40 px: ${JSON.stringify(call(name, "min_w"))}`);
  // Both give way, the name last: the chip shrinks first (its flex_shrink is larger).
  const shrink = (n) => call(n, "flex_shrink")?.[0] ?? 1;
  assert.ok(shrink(chip) > shrink(name), `the chip gives way first: chip ${shrink(chip)}, name ${shrink(name)}`);
  assert.deepEqual(state.violations, []);
});

test("header on this computer: the folder's name only, as before", async () => {
  state.shared.clear(); state.execLog.length = 0; state.overlays.length = 0; state.violations.length = 0; state.props = {};
  const dir = folder(["x.txt"]);
  const root = await open(dir, null);
  const head = byId(root, "fm-root");
  assert.equal(head.$.children.filter((c) => c?.$?.kind === "div").length, 1, "no chip");
  assert.deepEqual(state.violations, []);
});
