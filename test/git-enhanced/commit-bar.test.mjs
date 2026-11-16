// The commit bar as Herdr's tab bar is sized: its box and buttons 26 px tall, 12 px words, radius 6;
// ⋯ and the pen are icon buttons as the pages' others (no frame, no background of their own). They
// were 32 px, the tallest in the panel, ⋯ and the pen framed boxes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repo, mount, draw, byId, walk, settle, makeCx } from "./render/load.mjs";

const call = (d, m) => d.calls.find(([k]) => k === m)?.[1];
// How it is drawn: its calls without what names it, says it or does something (and the hover, a function).
const look = (d) => d.calls.filter(([m]) => !["id", "tooltip", "accessibility_label", "child", "children", "hover"].includes(m) && !/^on_/.test(m)).map(([m, a]) => `${m}(${a.join(",")})`);
const svgOf = (d) => { let p = null; walk({ $: d }, (x) => { if (x.kind === "svg") p ??= x.path; }); return p; };

async function page(width) {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "two\n"); });
  const view = await mount(r.dir, { palette: "theme" }), p = view.part;
  p.size = { width, height: 900 };
  return { view, p };
}

test("the box, Amend, Commit and Push are 26 px tall, the words 12 px, radius 6; ⋯ and the pen are icon buttons as the gear", async () => {
  for (const width of [368, 1300]) {
    const { view } = await page(width), tree = await draw(view);
    assert.deepEqual(call(byId(tree, "commit-message"), "min_h"), [26], `${width}: the box`);
    for (const id of ["amend", "commit", "push"]) {
      const d = byId(tree, id);
      assert.ok(d, `${width}: ${id}`);
      assert.deepEqual([call(d, "h"), call(d, "rounded"), call(d, "text_size")], [[26], [6], [12]], `${width}: ${id}`);
    }
    const gear = byId(tree, /^changes-settings-/);
    for (const id of ["commit-more", "commit-write"]) assert.deepEqual(look(byId(tree, id)), look(gear), `${width}: ${id} drawn as the gear`);
    assert.match(svgOf(byId(tree, "commit-write")), /\/sparkles\.svg$/);
  }
});

test("while a git action runs, ⋯ is greyed and not pressed, as an icon button that is off", async () => {
  const { view, p } = await page(368);
  p.busy = "fetch";
  const more = byId(await draw(view), "commit-more");
  assert.deepEqual(call(more, "opacity"), [0.7]);
  assert.equal(more.handlers.on_click, undefined);
  p.busy = null;
});

test("while the agent writes, the pen says Writing… in its place, 24 px tall, and keeps its right-click", async () => {
  const { view, p } = await page(368);
  p.writing = true;
  const pen = byId(await draw(view), "commit-write");
  assert.deepEqual(call(pen, "h"), [24]);
  assert.ok(pen.handlers.on_mouse_down?.length, "the right-click: another agent");
  let words = [];
  walk({ $: pen }, (x) => { for (const c of x.children ?? []) if (typeof c === "string") words.push(c); });
  assert.deepEqual(words, ["Writing…"]);
  p.writing = false;
});
