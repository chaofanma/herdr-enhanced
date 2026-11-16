// A page's top row as the others draw theirs. Under 600 px, Ask about diff (the Changes page's) is an
// icon button beside the gear, as the gear: it was a box on `raised` there, a background no other icon
// button of a top row has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repo, mount, draw, byId, walk, makeCx, settle } from "./render/load.mjs";
import { NAME } from "./mod.mjs";

// How an element looks: its calls, without the ones naming it, saying what it does or what it is for
// a screen reader (id, tooltip, handlers, role, accessibility_label) and its children; a hover by the
// calls it makes.
function replay(fn) {
  const calls = [];
  const p = new Proxy({}, { get: (_t, m) => (...a) => { calls.push(`${String(m)}(${a.map((x) => JSON.stringify(x)).join(",")})`); return p; } });
  fn(p);
  return calls;
}
function look(d) {
  const out = [];
  for (const [m, a] of d.calls) {
    if (["id", "tooltip", "child", "children", "role", "accessibility_label"].includes(m) || /^on_/.test(m)) continue;
    out.push(m === "hover" ? `hover(${replay(a[0]).join(".")})` : `${m}(${a.map((x) => JSON.stringify(x)).join(",")})`);
  }
  return out;
}
const rowOf = (tree, id) => { let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => (id instanceof RegExp ? id.test(String(c?.$?.id)) : c?.$?.id === id))) row = d; }); return row; };
const gapOf = (d) => d?.calls.find(([m]) => m === "gap")?.[1][0];

test("under 600 px Ask about diff is an icon button as the gear, beside it 2 px apart; wider, its words, apart from the gear", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  r.write("a.txt", "two\n");
  for (const width of [368, 1300]) {
    const view = await mount(r.dir, { palette: "theme" }), page = view.part;
    page.size = { width, height: 900 };
    if (page.open?.path !== "a.txt") { page.pick("a.txt", "unstaged", makeCx()); await settle(); }
    const tree = await draw(view), ask = byId(tree, "ask-diff"), gear = byId(tree, /^changes-settings-/);
    assert.ok(ask && gear, `${width}: Ask about diff and the gear`);
    const icons = rowOf(tree, gear.id);
    assert.equal(gapOf(icons), 2, `${width}: the gear's row`);
    if (width < 600) {
      assert.deepEqual(look(ask), look(gear), "narrow: Ask about diff drawn as the gear (no background of its own)");
      assert.deepEqual(icons.children.map((c) => c?.$?.id), ["ask-diff", gear.id], "beside it, before it");
      assert.ok(ask.calls.some(([m, a]) => m === "accessibility_label" && a[0] === "Ask about diff"), "named for a screen reader");
    } else {
      assert.notEqual(rowOf(tree, "ask-diff"), icons, "wide: its words, not in the icon buttons' row");
      assert.deepEqual(icons.children.map((c) => c?.$?.id), [gear.id]);
    }
  }
});
