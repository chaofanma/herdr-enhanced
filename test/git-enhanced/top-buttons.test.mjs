// The icon buttons of the pages' top rows are drawn alike, the Changes page's gear the model: no
// frame, 24 px, radius 6, a 14 px icon in `muted`, `hover` (and `foreground`) under the pointer.
// History's gear, its layout button and ⤢ / ⤡ were 22 px buttons with a frame on `raised` (⤢ and ⤡
// text characters), and the Review tab's ⤡ a 22 px text: the gear looked different on History, and
// so did ⤡ in the two tabs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repo, mount, draw, byId, walk, makeCx, settle } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

// A hover's calls: its function run on a recorder.
function replay(fn) {
  const calls = [];
  const p = new Proxy({}, { get: (_t, m) => (...a) => { calls.push(`${String(m)}(${a.map((x) => JSON.stringify(x)).join(",")})`); return p; } });
  fn(p);
  return calls;
}
// How an element looks: its calls, without the ones naming it or saying what it does (id, tooltip,
// its label for a screen reader, its handlers) and its children (its icon, apart); a hover by the calls it makes.
function look(d) {
  const out = [];
  for (const [m, a] of d.calls) {
    if (m === "id" || m === "tooltip" || m === "accessibility_label" || m === "child" || m === "children" || /^on_/.test(m)) continue;
    out.push(m === "hover" ? `hover(${replay(a[0]).join(".")})` : `${m}(${a.map((x) => JSON.stringify(x)).join(",")})`);
  }
  return out;
}
// Its content: the icons ([path, calls]) and the words in it.
function content(d) {
  const icons = [], words = [];
  walk({ $: d }, (x) => {
    if (x.kind === "svg") icons.push([x.path, x.calls]);
    for (const c of x.children) if (typeof c === "string" || typeof c === "number") words.push(String(c));
  });
  return { icons, words };
}
const ICON = [["size", [14]]];

test("every icon button of a page's top row looks like the Changes page's gear: History's gear, ⤢ and its layout button (with the commit), ⤡ in History's and Review's tabs", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "two\n"); });
  const changes = await mount(r.dir, { palette: "theme" });
  const tree = await draw(changes);
  const gear = byId(tree, /^changes-settings-/);
  assert.ok(gear, "the Changes page's gear");
  const model = look(gear);
  assert.ok(model.includes("size(24)") && !model.some((c) => c.startsWith("border")), `the model: 24 px, no frame: ${model.join(".")}`);
  assert.deepEqual(content(gear), { icons: [["mods/workspace-chrome/settings.svg", ICON]], words: [] });
  // `id` names one button; `path` is its icon's (a RegExp: one of those).
  const same = (tr, id, path) => {
    const d = byId(tr, id);
    assert.ok(d, `${id} is drawn`);
    assert.deepEqual(look(d), model, `${d.id}: drawn like the Changes page's gear`);
    const { icons, words } = content(d);
    assert.deepEqual(words, [], `${d.id}: an icon, no text`);
    assert.equal(icons.length, 1, `${d.id}: one icon`);
    assert.ok(path instanceof RegExp ? path.test(icons[0][0]) : icons[0][0] === path, `${d.id}: ${icons[0][0]}`);
    assert.deepEqual(icons[0][1], ICON, `${d.id}: its icon 14 px`);
  };
  // Open in a tab of its own: ⤢ (Herdr's zoom) here as in History; ⤡ (unzoom) back in both tabs.
  same(tree, "open-review", "mods/pane/zoom.svg");

  const history = await mount(r.dir, { palette: "theme", view: "history" });
  let h = await draw(history);
  // The layout button is with the commit (its files row): pick one.
  history.part.history.select(history.part.history.commits[0].hash, makeCx()); await settle();
  h = await draw(history);
  same(h, /^history-settings-/, "mods/workspace-chrome/settings.svg");
  same(h, /^history-layout-(auto|side|stacked)/, new RegExp(`^mods/${NAME}/layout-(side|stacked)\\.svg$`));
  same(h, "history-tab", "mods/pane/zoom.svg");

  // History in a tab of its own: ⤡ instead of ⤢.
  const base = tempDir("git-enhanced-buttons-");
  const tab = await mount(base, { palette: "theme", view: "history", root: r.dir, on: null });
  h = await draw(tab);
  assert.equal(byId(h, "history-tab"), null);
  same(h, "history-back", "mods/pane/unzoom.svg");
  same(h, /^history-settings-/, "mods/workspace-chrome/settings.svg");

  // The Review tab's ⤡: the same as History's.
  const review = await mount(base, { palette: "theme", review: true, root: r.dir, on: null });
  same(await draw(review), "review-back", "mods/pane/unzoom.svg");
});

test("the wrap buttons of Changes and History have no frame either: 24 px, a 14 px icon", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "two\n"); });
  const c = byId(await draw(await mount(r.dir, { palette: "theme" })), /^lines-mode-/);
  assert.ok(c, "Changes' wrap button");
  for (const d of [c]) {
    assert.ok(look(d).includes("size(24)") && !look(d).some((x) => x.startsWith("border")), `${d.id}: ${look(d).join(".")}`);
    assert.deepEqual(content(d), { icons: [[`mods/${NAME}/wrap.svg`, ICON]], words: [] });
  }
});

// The row an element is a child of (an element's id, or a RegExp of ids), and that row's gap.
const rowOf = (tree, id) => { let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => (id instanceof RegExp ? id.test(String(c?.$?.id)) : c?.$?.id === id))) row = d; }); return row; };
const gapOf = (d) => d?.calls.find(([m]) => m === "gap")?.[1][0];
const kids = (d) => d.children.map((c) => c?.$?.id ?? c?.$?.popover ?? c?.$?.kind);

test("icon buttons side by side are 2 px apart, as in Files' header: Changes' ±, ¶, Wrap, Split and ⤢; History's ±, ¶, Wrap, Split, ⤢ / ⤡ and gear (its text switches apart)", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "two\n"); });
  let tree = await draw(await mount(r.dir, { palette: "theme" }));
  let row = rowOf(tree, /^lines-mode-/);
  assert.equal(gapOf(row), 2, `Changes' bar: ${kids(row).join(" ")}`);
  assert.deepEqual(kids(row).filter((k) => /^(diff-options|diff-whitespace-|lines-mode-|diff-split-|open-review)/.test(k)).map((k) => k.replace(/-(wrap|scroll|on|off)$/, "")), ["diff-options", "diff-whitespace", "lines-mode", "diff-split", "open-review"]);
  assert.equal(kids(row).length, 5, "the five alone in their row");

  tree = await draw(await mount(r.dir, { palette: "theme", view: "history" }));
  row = rowOf(tree, /^history-settings-/);
  assert.equal(gapOf(row), 2, `History's top row: ${kids(row).join(" ")}`);
  const icons = (d) => kids(d).map((k) => k.replace(/^history-(lines|layout)-.*$/, "history-$1").replace(/^history-diff-split-.*$/, "split").replace(/^history-diff-whitespace-.*$/, "history-diff-whitespace").replace(/^history-settings-.*$/, "gear"));
  assert.deepEqual(icons(row).filter((k) => k !== "history-more"), ["history-diff-options", "history-diff-whitespace", "history-lines", "split", "history-tab", "gear"], "the icon buttons, in their order");
  assert.equal(kids(row).at(-1), byId(tree, /^history-settings-/).id, "the gear last");

  const base = tempDir("git-enhanced-buttons-gap-");
  tree = await draw(await mount(base, { palette: "theme", view: "history", root: r.dir, on: null }));
  row = rowOf(tree, /^history-settings-/);
  assert.equal(gapOf(row), 2);
  assert.deepEqual(icons(row).filter((k) => k !== "history-more"), ["history-diff-options", "history-diff-whitespace", "history-back", "gear"]);
  // The switches are text, not icon buttons: they keep the top row's own spacing, outside.
  const switches = rowOf(tree, "history-layout-unified");
  assert.ok(switches && switches !== row, "Unified | Split is not in the icon buttons' row");
});

test("History's page is drawn as the Changes page: a card of radius 10; its top row 42 px with 14 px padding, wherever it is", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "two\n"); });
  const callOf = (d, m) => d?.calls.find(([k]) => k === m)?.[1][0];
  const changesTree = await draw(await mount(r.dir, { palette: "theme" }));
  // The Changes page's top row: the one its icon buttons' row (the gear's) is in.
  const gearRow = rowOf(changesTree, /^changes-settings-/);
  let changesTop = null; walk(changesTree, (d) => { if (!changesTop && d.children?.some((c) => c?.$ === gearRow)) changesTop = d; });
  const changesCard = byId(changesTree, "changes");
  assert.equal(callOf(changesCard, "rounded"), 10);
  assert.deepEqual([callOf(changesTop, "h"), callOf(changesTop, "px")], [42, 14], "the Changes page's top row");
  const pages = [["the panel's page", { palette: "theme", view: "history" }, r.dir], ["a tab", { palette: "theme", view: "history", root: r.dir, on: null }, tempDir("git-enhanced-buttons-row-")]];
  for (const [where, props, dir] of pages) {
    const tree = await draw(await mount(dir, props));
    // The top row: the one holding the icon buttons' row (the gear's).
    const card = byId(tree, "history"), gear = rowOf(tree, /^history-settings-/);
    let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => c?.$ === gear)) row = d; });
    assert.equal(callOf(card, "rounded"), callOf(changesCard, "rounded"), `${where}: the card's radius`);
    assert.deepEqual([callOf(row, "h"), callOf(row, "px")], [42, 14], `${where}: History's top row`);
  }
});

test("History's ⋯ is an icon button too: the glyph ⋯ 14 px, as Files' ⋯; greyed and not pressed while there's no repository", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  const model = look(byId(await draw(await mount(r.dir, { palette: "theme" })), /^changes-settings-/));
  const glyph = (d) => { let g = null; walk({ $: d }, (x) => { if (x !== d && x.children.includes("⋯")) g = x; }); return g; };
  const more = byId(await draw(await mount(r.dir, { palette: "theme", view: "history" })), "history-more");
  assert.ok(more, "History's ⋯");
  assert.deepEqual(look(more), model, "drawn like the Changes page's gear");
  assert.deepEqual(content(more), { icons: [], words: ["⋯"] });
  assert.ok(glyph(more)?.calls.some(([m, a]) => m === "text_size" && a[0] === 14), "the glyph 14 px");
  assert.ok(more.handlers.on_click, "pressed: its menu");
  // A folder with no repository: there is nothing for its menu.
  const none = tempDir("git-enhanced-buttons-none-");
  const off = byId(await draw(await mount(none, { palette: "theme", view: "history" })), "history-more");
  assert.ok(off, "drawn there too");
  assert.equal(off.handlers.on_click, undefined, "not pressed");
  assert.ok(look(off).includes("opacity(0.7)") && !look(off).some((c) => c.startsWith("border") || c.startsWith("hover") || c.startsWith("cursor_pointer")), look(off).join("."));
});
