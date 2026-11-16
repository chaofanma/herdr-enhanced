// Ignore whitespace is a switch, so it is an icon button of its own (¶, lit while whitespace is
// ignored), beside Wrap and Split as they are; ± is a choice of several values, the lines of
// context, so it stays a menu, now with only that. It was a row in ±'s menu.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, press, settle, walk, makeCx, texts } from "./render/load.mjs";

const SETTINGS = "git-enhanced.settings";
const rowOf = (tree, id) => { let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => (id instanceof RegExp ? id.test(String(c?.$?.id)) : c?.$?.id === id))) row = d; }); return row; };
const ids = (d) => d.children.map((c) => c?.$?.id ?? c?.$?.popover ?? c?.$?.kind);
const icon = (d) => { let p = null; walk({ $: d }, (x) => { if (x.kind === "svg") p ??= x.path; }); return p; };
const tip = (d) => d.handlers.tooltip?.at(-1)?.[0] ?? d.calls.find(([m]) => m === "tooltip")?.[1][0];
// Lit: a background of its own (every theme color is one value in the stubs; a hover's is inside it).
const lit = (d) => d.calls.some(([m]) => m === "bg");
// How it is drawn, without what names it, says it or what it does.
const look = (d) => d.calls.filter(([m]) => !["id", "tooltip", "accessibility_label", "child", "children", "bg"].includes(m) && !/^on_/.test(m) && m !== "hover").map(([m, a]) => `${m}(${a.join(",")})`);

beforeEach(() => { state.shared.delete(SETTINGS); });

async function changed() {
  const r = repo(({ write, git }) => { write("a.txt", "one\ntwo\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "one  \nthree\n"); });
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  if (page.open?.path !== "a.txt") { page.pick("a.txt", "unstaged", makeCx()); await settle(); }
  return { r, view, page };
}

test("the Changes page's bar: ±, ¶, Wrap, Split, ⤢; ¶ is an icon button as Wrap is, lit while whitespace is ignored", async () => {
  const { view, page } = await changed();
  let tree = await draw(view);
  const row = rowOf(tree, /^diff-whitespace-/);
  assert.ok(row, "the whitespace button");
  assert.deepEqual(ids(row).map((k) => k.replace(/-(wrap|scroll|on|off)$/, "")), ["diff-options", "diff-whitespace", "lines-mode", "diff-split", "open-review"]);
  let b = byId(tree, "diff-whitespace-off");
  assert.match(icon(b), /\/pilcrow\.svg$/);
  assert.deepEqual(look(b), look(byId(tree, /^lines-mode-/)), "drawn as Wrap");
  assert.equal(lit(b), false);
  assert.equal(tip(b), "Whitespace shown · click to ignore it (git diff -w: hunks can't be staged or reverted then)");
  press(b); await settle();
  assert.deepEqual(state.shared.get(SETTINGS), { whitespace: true });
  tree = await draw(view); await settle(); tree = await draw(view);
  b = byId(tree, "diff-whitespace-on");
  assert.ok(lit(b), "lit while on");
  assert.equal(tip(b), "Whitespace ignored (git diff -w): hunks can't be staged or reverted · click to show it");
  assert.equal(page.hunksOff, true);
  press(b); await settle();
  assert.equal(state.shared.get(SETTINGS), null, "the default again: nothing stored");
});

test("±'s menu is the lines of context only; ± says them when they aren't git's 3", async () => {
  const { view, page } = await changed();
  page.choosingDiffOptions = true;
  let tree = await draw(view);
  assert.equal(byId(tree, "diff-whitespace"), null, "no whitespace row in ±'s menu");
  assert.deepEqual(["diff-context-3", "diff-context-10", "diff-context-file"].map((id) => Boolean(byId(tree, id))), [true, true, true]);
  assert.equal(tip(byId(tree, "diff-options-box")), undefined, "no tooltip over the open menu");
  page.choosingDiffOptions = false;
  tree = await draw(view);
  assert.equal(tip(byId(tree, "diff-options-box")), "Lines of context around each change: 3 · click to choose");
  state.shared.set(SETTINGS, { whitespace: true });
  tree = await draw(view);
  assert.deepEqual(texts({ $: byId(tree, "diff-options-box") }), [], "whitespace isn't ±'s: the icon alone");
  state.shared.set(SETTINGS, { context: 10 });
  tree = await draw(view);
  assert.deepEqual(texts({ $: byId(tree, "diff-options-box") }), ["10"]);
  state.shared.set(SETTINGS, { context: "file" });
  tree = await draw(view);
  assert.deepEqual(texts({ $: byId(tree, "diff-options-box") }), ["∞"]);
  assert.equal(tip(byId(tree, "diff-options-box")), "Lines of context around each change: the whole file · click to choose");
});

test("the Review tab has ¶ beside ± too", async () => {
  const { r } = await changed();
  const view = await mount(r.dir, { palette: "theme", review: true, root: r.dir });
  const tree = await draw(view);
  const row = rowOf(tree, /^diff-whitespace-/);
  assert.ok(row, "the whitespace button");
  const k = ids(row);
  assert.equal(k.indexOf(k.find((x) => /^diff-whitespace-/.test(x))), k.indexOf("diff-options") + 1, k.join(" "));
});

test("± is drawn as the icons beside it: Lucide's diff icon at 14 px, not a character in a smaller size", async () => {
  const { view } = await changed();
  let tree = await draw(view);
  const box = byId(tree, "diff-options-box");
  assert.match(icon(box) ?? "", /\/diff\.svg$/);
  let svg = null; walk({ $: box }, (x) => { if (x.kind === "svg") svg ??= x; });
  assert.deepEqual(svg.calls.find(([m]) => m === "size"), ["size", [14]]);
  assert.deepEqual(texts({ $: box }).map((w) => w.trim()).filter(Boolean), [], "no ± character");
  state.shared.set(SETTINGS, { context: 10 });
  tree = await draw(view);
  assert.deepEqual(texts({ $: byId(tree, "diff-options-box") }), ["10"], "the lines after it when they aren't 3");
});
