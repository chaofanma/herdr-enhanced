// A button whose menu opens at the pointer has no tooltip while that menu is open: the pointer is
// still on the button, so its tooltip came up over the menu's title (History's ⋯ showed it so). A
// screen reader still hears what it does; the tooltip is back once the menu is answered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, handler, lists, settle, makeCx, load, asOverlay } from "./render/load.mjs";

const { answer } = await load("question.js");
const tipOf = (d) => d?.handlers?.tooltip?.at(-1)?.[0];
const labelOf = (d) => d?.calls.find(([m]) => m === "accessibility_label")?.[1][0];

// Opens `id`'s menu (`how`: its click, or its right-click), checks the tooltip while it's open and
// after it's answered (Esc: null).
async function check(view, id, how = "on_click") {
  let tree = await draw(view), b = byId(tree, id);
  assert.ok(b, `${id} is drawn`);
  const tip = tipOf(b);
  assert.ok(tip, `${id} has a tooltip`);
  const before = state.overlays.length;
  if (how === "right") handler(b, "on_mouse_down")({ button: "right" }, makeCx()); else handler(b, "on_click")({}, makeCx());
  await settle();
  assert.equal(state.overlays.length, before + 1, `${id}: a menu opened`);
  const menu = state.overlays.at(-1);
  assert.ok(menu.props.question?.menu, `${id}: a menu`);
  b = byId(await draw(view), id);
  assert.equal(tipOf(b), undefined, `${id}: no tooltip over its open menu`);
  assert.equal(labelOf(b), labelOf(byId(tree, id)), `${id}: a screen reader still hears it`);
  asOverlay(menu, () => answer(menu.props.question.id, null)); await settle();
  assert.equal(tipOf(byId(await draw(view), id)), tip, `${id}: its tooltip back once the menu is answered`);
}

test("⋯ by Commit and the pen's right-click menu", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "two\n"); });
  const view = await mount(r.dir, { palette: "theme" });
  await check(view, "commit-more");
  await check(view, "commit-write", "right");
  assert.deepEqual(state.violations, []);
});

test("History's layout button", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "two\n"); git("commit", "-qam", "two"); });
  const view = await mount(r.dir, { palette: "theme", view: "history" }), h = view.part.history;
  handler(lists(await draw(view)).find((l) => l.listId === "history-commits"), "on_item_click")(h.commits[0].hash, makeCx()); await settle();
  const id = byId(await draw(view), /^history-layout-(auto|side|stacked)/)?.id;
  await check(view, id);
  assert.deepEqual(state.violations, []);
});

test("History's ⋯ and ▾ by Push", async () => {
  const { execFileSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const { tempDir } = await import("./tmp.mjs");
  const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const base = tempDir("git-enhanced-menutips-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a");
  sh(A, "config", "user.name", "t"); sh(A, "config", "user.email", "t@t"); sh(A, "config", "core.hooksPath", "/dev/null");
  execFileSync("sh", ["-c", "echo one > f.txt"], { cwd: A }); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  const history = await mount(A, { palette: "theme", view: "history" });
  await check(history, "history-more");
  const changes = await mount(A, { palette: "theme" });
  await check(changes, "push-menu");
  assert.deepEqual(state.violations, []);
});
