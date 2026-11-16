// The repository switcher's read of each repository's branch and changed files, when git doesn't
// answer (the exec couldn't start, the machine is unreachable, or it stopped before every repository
// was printed): what the last read knew of a branch stays, nothing it didn't read is counted, the
// card says how many it couldn't read, and a row with nothing to say under its name is one line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, texts, walk, settle, makeCx, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const { CARD_HEADING, CARD_ROW, CARD_ONE } = await load("ui.js");
const { checks } = await load("repotrust.js");

// A folder with two repositories below it, alpha and beta, a.txt changed in each.
function folder() {
  const dir = tempDir("git-enhanced-switcher-");
  for (const name of ["alpha", "beta"]) {
    const d = join(dir, name), git = (...a) => execFileSync("git", a, { cwd: d, encoding: "utf8" });
    mkdirSync(d); git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
    writeFileSync(join(d, "a.txt"), "one\n"); git("add", "-A"); git("commit", "-qm", "first");
    writeFileSync(join(d, "a.txt"), "two\n");
  }
  return dir;
}
// The switcher's read (reposcan.js infoArgs, with the counts): `sh -c script sh root…`; `any`: the
// one without the counts too (a folder without a repository of its own reads the branches and times
// once, to show the most recently changed).
const isRead = (c, a, any = false) => c === "sh" && /^for d; do$/m.test(String(a[1] ?? "")) && /symbolic-ref -q --short HEAD/.test(String(a[1] ?? "")) && (any || /status --porcelain/.test(String(a[1] ?? "")));
const h = (n) => n?.calls.findLast(([m]) => m === "h")?.[1][0];
// The card that holds the rows: the element whose children include the first row.
function cardOf(tree, rowId) {
  let card = null;
  walk(tree, (n) => { if (!card && n.children?.some((c) => c?.$?.id === rowId)) card = n; });
  return card;
}
async function opened(view, hook) {
  const set = view.part.repoSet;
  state.execHook = hook;
  try { set.openList(true, makeCx()); await settle(); return await draw(view); } finally { state.execHook = null; }
}

test("switcher: a read git doesn't answer keeps the branches from before, counts nothing, and says so", async () => {
  checks.clear();
  const view = await mount(folder(), { palette: "theme" }), set = view.part.repoSet;
  let tree = await opened(view, null);
  assert.deepEqual([texts(byId(tree, "repo-0")), texts(byId(tree, "repo-1"))], [["alpha", "main · 1 changed"], ["beta", "main · 1 changed"]]);
  assert.equal(byId(tree, "repo-unread"), null);
  set.openList(false, makeCx());
  tree = await opened(view, (c, a) => (isRead(c, a) ? Promise.reject(new Error("the machine is unreachable")) : null));
  assert.deepEqual([texts(byId(tree, "repo-0")), texts(byId(tree, "repo-1"))], [["alpha", "main"], ["beta", "main"]], "the branches the last read knew; no count");
  assert.deepEqual(texts(byId(tree, "repo-unread")), ["Couldn't read them just now: git didn't answer"]);
  set.openList(false, makeCx());
  // The next read that works: the counts again, no note.
  tree = await opened(view, null);
  assert.deepEqual(texts(byId(tree, "repo-1")), ["beta", "main · 1 changed"]);
  assert.equal(byId(tree, "repo-unread"), null);
  set.openList(false, makeCx());
  assert.deepEqual(state.violations, []);
});

test("switcher: a read that stopped part way shows what it read, and how many it couldn't", async () => {
  checks.clear();
  const view = await mount(folder(), { palette: "theme" }), set = view.part.repoSet;
  // As a read stopped (killed) after its first repository: alpha's fields, three changed, then nothing.
  const tree = await opened(view, (c, a) => (isRead(c, a) ? { code: 143, stdout: [a[3], "main", "", "", "3", ""].join("\0"), stderr: "" } : null));
  assert.deepEqual([texts(byId(tree, "repo-0")), texts(byId(tree, "repo-1"))], [["alpha", "main · 3 changed"], ["beta", "main"]], "beta: the branch read at the start, not 'no commits'");
  assert.deepEqual(texts(byId(tree, "repo-unread")), ["Couldn't read 1 of them just now: git didn't answer"]);
  set.openList(false, makeCx());
  assert.deepEqual(state.violations, []);
});

test("switcher: a row with nothing under its name is one line, and the card is as tall as its rows", async () => {
  checks.clear();
  // Every read fails, the one at the start too: nothing is known of either.
  const fail = (c, a) => (isRead(c, a, true) ? Promise.reject(new Error("unreachable")) : null);
  state.execHook = fail;
  let view;
  try { view = await mount(folder(), { palette: "theme" }); } finally { state.execHook = null; }
  const set = view.part.repoSet;
  const tree = await opened(view, fail);
  const rows = [byId(tree, "repo-0"), byId(tree, "repo-1")];
  assert.deepEqual(rows.map((r) => texts(r)), [["alpha"], ["beta"]], "no blank second line");
  assert.deepEqual(rows.map(h), [CARD_ONE, CARD_ONE]);
  const note = byId(tree, "repo-unread");
  assert.equal(h(note), CARD_ONE);
  // listCard: 12 px of padding and border, the rows' heights, 1 px between them.
  const heights = [CARD_HEADING, CARD_ONE, CARD_ONE, CARD_ONE];
  assert.equal(h(cardOf(tree, "repo-0")), 12 + heights.reduce((a, b) => a + b, 0) + heights.length - 1);
  set.openList(false, makeCx());
  // With a detail, a row is two lines tall.
  const tree2 = await opened(view, null);
  assert.equal(h(byId(tree2, "repo-0")), CARD_ROW);
  set.openList(false, makeCx());
  assert.deepEqual(state.violations, []);
});
