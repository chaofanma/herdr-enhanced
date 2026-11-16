// Several commits at once in History: ⌘-click and ⇧-click select, the selection's menu cherry-picks
// them oldest first (-x) and reverts them newest first; a commit's details say what holds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, lists, handler, texts, settle, makeCx } from "./render/load.mjs";
import { answer } from "./answers.mjs";

const commitsList = (tree) => lists(tree).find((l) => l.listId === "history-commits");
async function clickRow(view, hash, modifiers = {}) {
  const tree = await draw(view);
  handler(byId(tree, "history-list-area"), "on_mouse_down")({ modifiers }, makeCx());
  handler(commitsList(tree), "on_item_click")(hash, makeCx());
  await settle();
}

test("History: select several commits, cherry-pick them oldest first with -x, revert them newest first; what holds a commit", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "f\n"); git("add", "-A"); git("commit", "-qm", "init");
    git("switch", "-q", "-c", "side");
    for (const n of ["a", "b", "c"]) { write(`${n}.txt`, `${n}\n`); git("add", "-A"); git("commit", "-qm", `Add ${n}`); }
    git("tag", "v-side"); git("switch", "-q", "main");
  });
  const [c, b, a] = r.git("rev-list", "side", "-3").trim().split("\n");
  const view = await mount(r.dir, { palette: "theme", view: "history" }), h = view.part.history;
  h.all = true; h.reload(makeCx("async")); await settle();
  await clickRow(view, a);
  let tree = await draw(view);
  assert.equal(texts(byId(tree, "history-holds")).join(" "), "On branches: side · Tags: v-side");
  await clickRow(view, c, { shift: true });
  assert.deepEqual(h.picks.selected, [a, b, c].filter((x) => [a, b, c].includes(x)).sort((x, y) => h.commits.findIndex((k) => k.hash === x) - h.commits.findIndex((k) => k.hash === y)));
  assert.equal(h.selected, c, "the ⇧-clicked commit's details show");
  await clickRow(view, b, { platform: true });
  assert.deepEqual(h.picks.selected.sort(), [a, c].sort(), "⌘ takes b out");
  // The marked rows are the selection (b, the one clicked before, isn't), and the details one of them.
  const t = new Proxy({}, { get: () => "#123456" }), marked = (hash) => {
    const row = h.row(h.commits.findIndex((k) => k.hash === hash), t, 26, true, "mono");
    return row.$.calls.some(([m, [v]]) => m === "border_color" && v === "#123456");
  };
  assert.deepEqual([marked(a), marked(b), marked(c)], [true, false, true]);
  await clickRow(view, c, { platform: true });
  assert.deepEqual([marked(a), marked(c)], [true, false]);
  assert.deepEqual(h.picks.selected, [a], "⌘ takes c out");
  assert.equal(h.selected, a, "c's details go; a, still selected, shows");
  await clickRow(view, c, { platform: true });
  assert.equal(h.selected, c, "⌘ adds c back: its details show");
  // The selection's menu: cherry-pick a and c onto main, oldest first, -x.
  handler(commitsList(await draw(view)), "on_item_secondary_click")(c, {}, makeCx());
  let { spec } = await answer({ pick: "pick" });
  assert.equal(spec.title, "2 commits selected");
  await answer({ set: (q) => { q.checks.x = true; } });
  ({ spec } = await answer());
  assert.equal(spec.title, "Cherry-pick 2 commits onto main, oldest first, each message saying where it came from?");
  assert.deepEqual(r.git("log", "--format=%s", "-3").trim().split("\n"), ["Add c", "Add a", "init"], h.line);
  assert.match(r.git("log", "-1", "--format=%B").trim(), new RegExp(`\\(cherry picked from commit ${c}\\)$`));
  assert.deepEqual(h.picks.selected, [], "the selection goes after");
  // Revert the two new commits, newest first.
  h.reload(makeCx("async")); await settle();
  const [n1, n2] = r.git("rev-list", "main", "-2").trim().split("\n");
  await clickRow(view, n1); await clickRow(view, n2, { platform: true });
  handler(commitsList(await draw(view)), "on_item_secondary_click")(n2, {}, makeCx());
  await answer({ pick: "revert" }); await answer();
  ({ spec } = await answer());
  assert.equal(spec.title, "Revert 2 commits on main, newest first?");
  assert.deepEqual(r.git("log", "--format=%s", "-2").trim().split("\n"), ['Revert "Add a"', 'Revert "Add c"'], h.line);
  assert.deepEqual(state.violations, []);
});

test("History: a commit's files show before what holds it is read (for-each-ref --contains comes after)", async () => {
  const r = repo(({ write, git }) => { write("f.txt", "f\n"); git("add", "-A"); git("commit", "-qm", "init"); write("g.txt", "g\n"); git("add", "-A"); git("commit", "-qm", "Add g"); });
  const head = r.git("rev-parse", "HEAD").trim();
  const view = await mount(r.dir, { palette: "theme", view: "history" }), h = view.part.history;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  state.execHook = (command, args) => (command === "git" && args.includes("--contains") ? held : null);
  try {
    await clickRow(view, head);
    assert.deepEqual(h.files?.map((f) => f.path), ["g.txt"], "the files are there while --contains runs");
    assert.equal(h.details?.holds, null);
    release({ code: 0, stdout: "refs/heads/main\n", stderr: "" }); await settle();
    assert.equal(texts(byId(await draw(view), "history-holds")).join(" "), "On branches: main");
  } finally { state.execHook = null; }
  assert.deepEqual(state.violations, []);
});
