// A menu opened from a button opens touching it, not where the press landed: under a button of a
// page's top rows, 3 px off (its right edge on the button's, or its left edge for a button at the
// left), over the commit bar's (its bottom 3 px above the button); a menu that follows from one of
// its items opens against the same button. Herdr zooms a popup's size, not its `at`. While its menu
// is open the button looks pressed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { state, mount, draw, byId, handler, lists, settle, makeCx, load, asOverlay } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";
import { THEMES } from "../shared/themecheck.mjs";

const { answer } = await load("question.js");
const t = THEMES[0].colors;
const bgs = (n) => n.calls.filter(([m]) => m === "bg").map(([, a]) => a[0]);

// Presses `id` where `bounds` say it is (the event Herdr hands its on_mouse_down), clicks it, and
// returns the menu it opened (its openOverlay spec).
async function openFrom(view, id, bounds) {
  const b = byId(await draw(view), id);
  assert.ok(b, `${id} is drawn`);
  const down = (b.handlers.on_mouse_down ?? []).find(([button]) => button === "left");
  assert.ok(down, `${b.id}: a press keeps where it is`);
  down.at(-1)({ button: "left", click_count: 1, position: { x: bounds.x + 4, y: bounds.y + 4 }, local_position: { x: 4, y: 4 }, bounds, modifiers: {} }, makeCx());
  const before = state.overlays.length;
  handler(b, "on_click")({ click_count: 1, modifiers: {} }, makeCx());
  await settle();
  assert.equal(state.overlays.length, before + 1, `${b.id}: a menu opened`);
  const menu = state.overlays.at(-1);
  assert.equal(menu.kind, "popup");
  return menu;
}
const close = async (menu, pick = null) => { asOverlay(menu, () => answer(menu.props.question.id, pick)); await settle(); };
const z = (n) => n * (state.settings?.zoom ?? 1);
const below = (b, menu, align = "right") => ({ x: align === "left" ? b.x : b.x + b.width - z(menu.width), y: b.y + b.height + z(3) });
const above = (b, menu) => ({ x: b.x + b.width - z(menu.width), y: b.y - z(3 + menu.height) });

function withRemote() {
  const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const base = tempDir("git-enhanced-menuat-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  for (const c of ["a", "b"]) {
    sh(base, "clone", "-q", "remote.git", c);
    const d = join(base, c);
    sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "core.hooksPath", "/dev/null");
  }
  const A = join(base, "a"), B = join(base, "b");
  execFileSync("sh", ["-c", "echo one > f.txt"], { cwd: A }); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  // B adds a commit A hasn't got: A is one behind after a fetch (Pull ↓1 ▾).
  sh(B, "pull", "-q", "origin", "main"); execFileSync("sh", ["-c", "echo two > g.txt"], { cwd: B }); sh(B, "add", "-A"); sh(B, "commit", "-qm", "Second"); sh(B, "push", "-q", "origin", "HEAD:main");
  sh(A, "fetch", "-q");
  return A;
}

test("the commit bar's ⋯ and ▾ open their menus over the button, right edges lined up; pressed while open", async () => {
  const was = state.palette;
  state.palette = t;
  try {
    const A = withRemote();
    const view = await mount(A, { palette: "theme" });
    const more = { x: 300, y: 700, width: 24, height: 24 };
    let menu = await openFrom(view, "commit-more", more);
    assert.deepEqual(menu.at, above(more, menu));
    assert.ok(bgs(byId(await draw(view), "commit-more")).includes(t.selected), "⋯ looks pressed while its menu is open");
    await close(menu);
    assert.ok(!bgs(byId(await draw(view), "commit-more")).includes(t.selected), "and not once it's answered");
    const push = { x: 420, y: 701, width: 22, height: 26 };
    menu = await openFrom(view, "push-menu", push);
    assert.deepEqual(menu.at, above(push, menu));
    assert.ok(bgs(byId(await draw(view), "push-menu")).includes(t.hover), "▾ looks pressed while its menu is open");
    await close(menu);
    assert.ok(!bgs(byId(await draw(view), "push-menu")).includes(t.hover));
    // No room over it (a page at the top of the window): under it instead.
    const high = { x: 300, y: 20, width: 24, height: 24 };
    menu = await openFrom(view, "commit-more", high);
    assert.deepEqual(menu.at, below(high, menu));
    await close(menu);
    // Pull ↓1 ▾, at the left of the bar over the files: under it, left edges lined up.
    const pull = { x: 120, y: 40, width: 70, height: 22 };
    menu = await openFrom(view, /^pull-/, pull);
    assert.deepEqual(menu.at, below(pull, menu, "left"));
    assert.ok(bgs(byId(await draw(view), /^pull-/)).includes(t.hover), "Pull ▾ looks pressed while its menu is open");
    await close(menu);
    assert.deepEqual(state.violations, []);
  } finally { state.palette = was; }
});

test("History's ⋯ and layout button open under the button; a menu that follows opens there too; Herdr zooms the size only", async () => {
  const was = state.palette;
  state.palette = t;
  try {
    const A = withRemote();
    const view = await mount(A, { palette: "theme", view: "history" });
    const more = { x: 380, y: 10, width: 24, height: 24 };
    let menu = await openFrom(view, "history-more", more);
    assert.deepEqual(menu.at, below(more, menu));
    assert.ok(bgs(byId(await draw(view), "history-more")).includes(t.selected), "⋯ looks pressed while its menu is open");
    // Worktrees: the next menu, as wide as its own (340), against the same button.
    await close(menu, "worktrees");
    const next = state.overlays.at(-1);
    assert.notEqual(next, menu, "a second menu");
    assert.equal(next.width, 340);
    assert.deepEqual(next.at, below(more, next));
    assert.ok(bgs(byId(await draw(view), "history-more")).includes(t.selected), "⋯ still lit while the menu that followed is open");
    await close(next);
    assert.ok(!bgs(byId(await draw(view), "history-more")).includes(t.selected));
    // The layout button shows once a commit is selected.
    const h = view.part.history;
    handler(lists(await draw(view)).find((l) => l.listId === "history-commits"), "on_item_click")(h.commits[0].hash, makeCx()); await settle();
    const layout = { x: 330, y: 10, width: 24, height: 24 };
    menu = await openFrom(view, /^history-layout-/, layout);
    assert.deepEqual(menu.at, below(layout, menu));
    assert.ok(bgs(byId(await draw(view), /^history-layout-/)).includes(t.selected), "the layout button looks pressed while its menu is open");
    await close(menu);
    // Zoomed 125 %: the press's bounds are the window's, the menu 1.25 times as wide.
    state.settings = { zoom: 1.25 };
    try {
      menu = await openFrom(view, "history-more", more);
      assert.deepEqual(menu.at, { x: 380 + 24 - 1.25 * menu.width, y: 10 + 24 + 1.25 * 3 });
      await close(menu);
    } finally { state.settings = undefined; }
    assert.deepEqual(state.violations, []);
  } finally { state.palette = was; }
});
