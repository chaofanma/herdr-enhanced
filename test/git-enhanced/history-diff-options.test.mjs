// History's commit diffs follow the diff settings as the Changes page's do: ± (the lines of context)
// and ¶ (ignore whitespace) in its top row, before Wrap and Split, in the panel and in its tab; a
// change reads the shown diff again. History read every diff with git's own 3 lines and the
// whitespace, whatever the settings said.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, press, settle, walk, makeCx, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const { SAFE_ARGS } = await load("gittrust.js");
const SETTINGS = "git-enhanced.settings";
const rowOf = (tree, id) => { let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => (id instanceof RegExp ? id.test(String(c?.$?.id)) : c?.$?.id === id))) row = d; }); return row; };
const ids = (d) => d.children.map((c) => c?.$?.id ?? c?.$?.popover ?? c?.$?.kind);
const bare = (a) => (a.slice(0, SAFE_ARGS.length).join("\0") === SAFE_ARGS.join("\0") ? a.slice(SAFE_ARGS.length) : a);
const diffCalls = () => state.execLog.filter(([c, a]) => c === "git" && bare(a)[0] === "diff" && a.includes("a.txt"));

beforeEach(() => { state.shared.delete(SETTINGS); });

function changedTwice() {
  return repo(({ write, git }) => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    write("a.txt", lines.join("\n") + "\n"); git("add", "-A"); git("commit", "-qm", "one");
    lines[4] = "line 5  "; lines[20] = "line 21 changed";
    write("a.txt", lines.join("\n") + "\n"); git("add", "-A"); git("commit", "-qm", "two");
  });
}

test("History's top row: ± and ¶ before Wrap and Split; they read the commit's diff again with the lines of context and without whitespace", async () => {
  const r = changedTwice();
  const view = await mount(r.dir, { palette: "theme", view: "history" }), page = view.part, h = page.history;
  let tree = await draw(view); await settle();
  h.select(h.commits[0].hash, makeCx()); await settle();
  if (h.file !== "a.txt") { h.pickFile("a.txt", makeCx()); await settle(); }
  tree = await draw(view);
  const row = rowOf(tree, /^history-diff-whitespace-/);
  assert.ok(row, "History's ¶");
  const order = ids(row).map((k) => k.replace(/-(on|off|wrap|scroll)$/, ""));
  assert.deepEqual(order.slice(0, 4), ["history-diff-options", "history-diff-whitespace", "history-lines", "history-diff-split"], order.join(" "));
  assert.equal(page.diff.hunks.length, 2, "a change of whitespace and one of words");
  state.execLog.length = 0;
  press(byId(tree, "history-diff-whitespace-off")); await settle();
  assert.deepEqual(state.shared.get(SETTINGS), { whitespace: true });
  await draw(view); await settle(); tree = await draw(view);
  assert.ok(diffCalls().some(([, a]) => a.includes("-w")), "read again with -w");
  assert.equal(page.diff.hunks.length, 1, "the whitespace change goes");
  assert.ok(byId(tree, "history-diff-whitespace-on"), "lit");
  state.execLog.length = 0;
  state.shared.set(SETTINGS, { context: 10 });
  await draw(view); await settle(); await draw(view);
  assert.ok(diffCalls().some(([, a]) => a.includes("-U10") && !a.includes("-w")), "read again with 10 lines, whitespace shown");
  assert.equal(page.diff.hunks.length, 1, "10 lines of context join the two changes");
  page.choosingDiffOptions = true; tree = await draw(view);
  press(byId(tree, "history-diff-context-3"));
  assert.equal(state.shared.get(SETTINGS), null, "git's 3 again: nothing stored");
  assert.deepEqual(state.violations, []);
});

test("the History tab has ± and ¶ too", async () => {
  const r = changedTwice();
  const tab = await mount(tempDir("git-enhanced-ws-"), { palette: "theme", view: "history", root: r.dir, on: null });
  const tree = await draw(tab);
  assert.ok(byId(tree, "history-diff-options-box") && byId(tree, "history-diff-whitespace-off"));
  assert.deepEqual(state.violations, []);
});
