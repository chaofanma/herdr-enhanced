// The diff in the panel side by side: a Split icon button beside Wrap, on the Changes page's bar and in
// History's top row (Herdr's split-right icon), lit while on. It sets the shared layout the Review and
// History tabs' Unified | Split switch sets too, so the choice is the same everywhere and kept. The
// panel's diffs showed one column only.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, load, repo, mount, draw, byId, press, settle, walk, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const { KEY } = await load("id.js");
const ICON = "mods/pane/split-right.svg";
const rowOf = (tree, id) => { let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => (id instanceof RegExp ? id.test(String(c?.$?.id)) : c?.$?.id === id))) row = d; }); return row; };
const ids = (d) => d.children.map((c) => c?.$?.id ?? c?.$?.popover ?? c?.$?.kind);
const lit = (d) => d.calls.some(([m, a]) => m === "bg" && a[0] === "#selected" || (m === "bg" && String(a[0]).includes("selected")));
const icon = (d) => { let p = null; walk({ $: d }, (x) => { if (x.kind === "svg") p ??= x.path; }); return p; };
const tip = (d) => d.handlers.tooltip?.at(-1)?.[0];

beforeEach(() => { state.shared.delete(KEY.layout); });

test("Changes' bar: ±, ¶, Wrap, Split, ⤢; Split turns the panel's diff side by side, and back", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\ntwo\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "one\nthree\n"); });
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  if (page.open?.path !== "a.txt") { page.pick("a.txt", "unstaged", makeCx()); await settle(); }
  let tree = await draw(view);
  const row = rowOf(tree, /^diff-split-/);
  assert.ok(row, "the Split button");
  assert.deepEqual(ids(row).map((k) => k.replace(/-(wrap|scroll|on|off)$/, "")), ["diff-options", "diff-whitespace", "lines-mode", "diff-split", "open-review"]);
  let b = byId(tree, "diff-split-off");
  assert.equal(icon(b), ICON);
  assert.equal(tip(b), "One column · click for old | new side by side");
  assert.equal(page.diff.sideBySide(), false);
  press(b); await settle();
  assert.equal(state.shared.get(KEY.layout), "split");
  assert.equal(page.diff.sideBySide(), true, "side by side in the panel");
  tree = await draw(view);
  b = byId(tree, "diff-split-on");
  assert.ok(b, "on");
  assert.equal(tip(b), "Old | new side by side · click for one column");
  assert.ok(b.calls.some(([m]) => m === "bg"), "lit while on");
  press(b); await settle();
  assert.equal(state.shared.get(KEY.layout), "unified");
  assert.equal(page.diff.sideBySide(), false);
  assert.deepEqual(state.violations, []);
});

test("History's top row in the panel: ±, ¶, Wrap, Split, then the rest; the History tab's Unified | Split shows the same choice", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\ntwo\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "one\nthree\n"); git("add", "-A"); git("commit", "-qm", "two"); });
  const view = await mount(r.dir, { palette: "theme", view: "history" }), h = view.part.history;
  let tree = await draw(view);
  const row = rowOf(tree, /^history-diff-split-/);
  assert.ok(row, "History's Split button");
  const order = ids(row).map((k) => k.replace(/^history-(lines|layout)-.*$/, "history-$1").replace(/^history-diff-split-.*$/, "split").replace(/^history-settings-.*$/, "gear"));
  assert.deepEqual(order.slice(0, 4), ["history-diff-options", "history-diff-whitespace-off", "history-lines", "split"], order.join(" "));
  press(byId(tree, "history-diff-split-off")); await settle();
  assert.equal(state.shared.get(KEY.layout), "split");
  assert.ok(byId(await draw(view), "history-diff-split-on"));
  // The History tab: its own Unified | Split switch, the same choice.
  const base = tempDir("git-enhanced-split-");
  const tab = await mount(base, { palette: "theme", view: "history", root: r.dir, on: null });
  tree = await draw(tab);
  assert.equal(byId(tree, /^history-diff-split-/), null, "the tab has the words instead");
  const split = byId(tree, "history-layout-split");
  assert.ok(split && split.calls.some(([m]) => m === "bg" && true), "Split chosen there too");
  assert.deepEqual(state.violations, []);
});
