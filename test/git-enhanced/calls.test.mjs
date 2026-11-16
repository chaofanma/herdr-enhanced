// The render stubs' calls (stubs.mjs): Herdr runs a mod's code in calls, each a copy's; what a call
// starts is that copy's and never comes back once the copy closed. The tests rely on these rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, stubs, settle, makeCx } from "./render/load.mjs";

test("an exec a closed copy's call started is a violation and never comes back; a live one's does", async () => {
  state.violations.length = 0;
  const menu = { name: "popup o9", closed: false };
  let back = "no";
  stubs.inCall(menu, () => { menu.closed = true; stubs.exec("git", ["--version"]).then(() => { back = "yes"; }); });
  await settle();
  assert.equal(back, "no");
  assert.match(state.violations.join("\n"), /exec git --version was started in popup o9's call, which closed: it never comes back/);
  state.violations.length = 0;
  const page = { name: "the page", closed: false };
  stubs.inCall(page, () => { stubs.exec("git", ["--version"]).then(() => { back = "yes"; }); });
  await settle();
  assert.equal(back, "yes");
  assert.deepEqual(state.violations, []);
});

test("what a promise settled in a call does next is that call's; a page's poll takes it to the page's", async () => {
  state.violations.length = 0;
  const page = { name: "the page", closed: false }, menu = { name: "popup o8", closed: false };
  let resolve, seen = [];
  const asked = new Promise((r) => { resolve = r; });
  // The flow awaits in the page; the answer comes in the menu's call, which closes.
  asked.then(() => seen.push(state.call?.name));
  stubs.inCall(menu, () => { resolve("x"); stubs.closeOverlay("none"); });
  await settle();
  assert.deepEqual(seen, ["popup o8"], "it goes on in the menu's call");
  // A poll of the page's ticks after the menu's call, in the page's call.
  let ticked = null;
  stubs.inCall(page, () => { const t = makeCx("async").timer.every(25, () => { ticked = state.call?.name; t.cancel(); }); });
  stubs.inCall(menu, () => {});
  await settle();
  assert.equal(ticked, "the page");
});
