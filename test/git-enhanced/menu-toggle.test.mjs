// A second press on a button whose menu is open closes the menu: Herdr closes a popup at a press
// beside it, and the click that follows that press must not open the menu again. The press after
// that opens it again. A press on another menu button while one is open opens that one's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { state, mount, draw, byId, handler, lists, settle, makeCx, load, asOverlay } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const { answer } = await load("question.js");
const B = { x: 300, y: 300, width: 24, height: 24 };

// A press on `id`, as Herdr hands it to the button.
async function down(view, id) {
  const b = byId(await draw(view), id);
  assert.ok(b, `${id} is drawn`);
  const d = (b.handlers.on_mouse_down ?? []).find(([button]) => button === "left");
  assert.ok(d, `${b.id} takes a press`);
  d.at(-1)({ button: "left", click_count: 1, position: { x: B.x + 4, y: B.y + 4 }, local_position: { x: 4, y: 4 }, bounds: B, modifiers: {} }, makeCx());
}
// The click that ends it, on the button as it is drawn now.
async function up(view, id) {
  handler(byId(await draw(view), id), "on_click")({ click_count: 1, modifiers: {} }, makeCx());
  await settle();
}
// Herdr closes the open popup (the press landed beside it, on its backdrop).
const herdrCloses = async (menu) => { asOverlay(menu, () => answer(menu.props.question.id, null)); await settle(); };

async function toggles(view, id) {
  let before = state.overlays.length;
  await down(view, id); await up(view, id);
  assert.equal(state.overlays.length, before + 1, `${id}: a press opens its menu`);
  const menu = state.overlays.at(-1);
  // The second press: Herdr closes the menu at the press; the click opens nothing.
  before = state.overlays.length;
  await down(view, id);
  await herdrCloses(menu);
  await up(view, id);
  assert.equal(state.overlays.length, before, `${id}: a second press only closes its menu`);
  // The next press opens it again.
  await down(view, id); await up(view, id);
  assert.equal(state.overlays.length, before + 1, `${id}: the press after that opens it again`);
  await herdrCloses(state.overlays.at(-1));
}

function withRemote() {
  const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const base = tempDir("git-enhanced-menutoggle-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  for (const c of ["a", "b"]) {
    sh(base, "clone", "-q", "remote.git", c);
    const d = join(base, c);
    sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "core.hooksPath", "/dev/null");
  }
  const A = join(base, "a"), Bd = join(base, "b");
  execFileSync("sh", ["-c", "echo one > f.txt"], { cwd: A }); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(Bd, "pull", "-q", "origin", "main"); execFileSync("sh", ["-c", "echo two > g.txt"], { cwd: Bd }); sh(Bd, "add", "-A"); sh(Bd, "commit", "-qm", "Second"); sh(Bd, "push", "-q", "origin", "HEAD:main");
  sh(A, "fetch", "-q");
  return A;
}

test("⋯ by Commit, ▾ by Push and Pull ▾: a second press closes the menu", async () => {
  const view = await mount(withRemote(), { palette: "theme" });
  await toggles(view, "commit-more");
  await toggles(view, "push-menu");
  await toggles(view, /^pull-/);
  assert.deepEqual(state.violations, []);
});

test("History's ⋯ and layout button: a second press closes the menu; a press on the other opens its own", async () => {
  const view = await mount(withRemote(), { palette: "theme", view: "history" });
  await toggles(view, "history-more");
  const h = view.part.history;
  handler(lists(await draw(view)).find((l) => l.listId === "history-commits"), "on_item_click")(h.commits[0].hash, makeCx()); await settle();
  await toggles(view, /^history-layout-/);
  // ⋯'s menu open, a press on the layout button: Herdr closes ⋯'s, and the layout menu opens.
  await down(view, "history-more"); await up(view, "history-more");
  const more = state.overlays.at(-1), before = state.overlays.length;
  await down(view, /^history-layout-/);
  await herdrCloses(more);
  await up(view, /^history-layout-/);
  assert.equal(state.overlays.length, before + 1, "the layout menu opens");
  assert.equal(state.overlays.at(-1).props.question.title, "History layout");
  await herdrCloses(state.overlays.at(-1));
  assert.deepEqual(state.violations, []);
});
