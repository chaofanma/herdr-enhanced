// The Changes page against real temp repositories, with Herdr's rules in the stubs (render/stubs.mjs):
// what it lists, what it opens, its rows, and that no render notifies or sets shared state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, renderNow, byId, allById, lists, renderRows, handler, press, textOf, walk, settle, makeCx, load, asOverlay } from "./render/load.mjs";
import { NAME } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const { KEY } = await load("id.js");

function twice() {
  return repo(({ write, git }) => {
    write("a.txt", "one\ntwo\nthree\n"); write("b.txt", "b\n"); write("gone.txt", "g\n");
    git("add", "-A"); git("commit", "-qm", "one");
    write("a.txt", "one\nTWO\nthree\n"); git("add", "a.txt");      // staged…
    write("a.txt", "one\nTWO\nthree\nfour\n");                     // …then edited again
    write("b.txt", "b changed\n");                                  // unstaged
    write("new.txt", "fresh\nfile\n");                              // untracked
    git("rm", "-q", "gone.txt");                                    // a staged deletion
  });
}

test("the diff under the file list gets the page's height: its row stretches what it holds (items_stretch)", async () => {
  // Without it a click picks a file and the whole area under the list stays empty: the row around
  // the diff is an h_flex, which centres what it holds, so without items_stretch the diff's box is as
  // tall as its content, and a virtual list sized to that is 0 px tall.
  const r = twice(), view = await mount(r.dir);
  for (const width of [368, 1300]) {
    view.part.size = { width, height: 900 };
    const tree = await draw(view);
    let row = null;
    const look = (n) => { if (row || !n?.$) return; if (n.$.children.some((c) => c?.$?.id === "changes-diff-box")) row = n.$; else n.$.children.forEach(look); };
    look(tree);
    assert.ok(row, "the diff box's row");
    assert.ok(row.calls.some(([m]) => m === "items_stretch"), `the row stretches the diff box (${row.calls.map(([m]) => m).join(" ")})`);
  }
  assert.deepEqual(state.violations, []);
});

test("the hint over the diff is no wider than the diff less its margins, and wraps", async () => {
  // With only its text's width as a limit it would take the whole diff's width, and its right margin
  // would push its first letters past the diff's left edge.
  const r = twice(), view = await mount(r.dir);
  const page = view.part;
  page.pick("a.txt", "unstaged", makeCx()); await settle();
  for (const width of [300, 900]) {
    page.diff.setWidth(width);
    const tree = await draw(view);
    let hint = null;
    walk(tree, (n) => { if (!hint && n.calls?.some(([m, a]) => m === "text_size" && a[0] === 10) && n.calls.some(([m]) => m === "absolute")) hint = n; });
    assert.ok(hint, `the hint at ${width}px`);
    const maxW = hint.calls.find(([m]) => m === "max_w")?.[1][0], right = hint.calls.find(([m]) => m === "right")?.[1][0];
    assert.ok(maxW !== undefined && right + maxW <= width - 14, `inside the diff with a margin on the left too (right ${right}, max_w ${maxW}, diff ${width})`);
    assert.ok(hint.calls.some(([m]) => m === "whitespace_normal"), "it wraps rather than running off");
    assert.equal(textOf({ $: hint }), "Click a line to comment · right-click: ask, or open at the line");
  }
  assert.deepEqual(state.violations, []);
});

test("the sections: Staged, then Unstaged; a file staged and edited again is in both, with its own numbers", async () => {
  const r = twice(), view = await mount(r.dir);
  const page = view.part;
  const sections = page.sections();
  assert.deepEqual(sections.map((g) => [g.key, g.rows.map((x) => `${x.letter} ${x.f.path} +${x.add} -${x.del}`)]), [
    ["staged", ["M a.txt +1 -1", "D gone.txt +0 -1"]],
    ["unstaged", ["M a.txt +1 -0", "M b.txt +1 -1", "A new.txt +0 -0"]],
  ]);
  // The first file opens by itself: the staged part of a.txt only.
  assert.deepEqual(page.open, { path: "a.txt", section: "staged" });
  const lines = () => page.diff.rows.map((x) => (x.kind === "@" ? x.text : `${x.kind}${x.text}`));
  assert.deepEqual(lines(), ["@@ -1,3 +1,3 @@", " one", "-two", "+TWO", " three"]);
  const tree = await draw(view);
  assert.ok(byId(tree, "section-staged") && byId(tree, "section-unstaged"));
  assert.ok(byId(tree, "file-staged-a.txt") && byId(tree, "file-unstaged-a.txt"), "the ids keep the section");
  assert.deepEqual(state.violations, []);
  // Its unstaged row diffs only the second edit; the untracked file shows whole and gets its count.
  press(byId(tree, "file-unstaged-a.txt"));
  await settle();
  assert.deepEqual(page.diff.rows.filter((x) => x.kind === "+").map((x) => x.text), ["four"]);
  press(byId(await draw(view), "file-unstaged-new.txt"));
  await settle();
  assert.deepEqual(lines(), ["@@ -0,0 +1,2 @@", "+fresh", "+file"]);
  await page.refresh(makeCx("async")); await settle();
  assert.equal(page.sections()[1].rows.find((x) => x.f.path === "new.txt").add, 2, "the new file's lines, once read");
  // Clicking the open row again closes it.
  press(byId(await draw(view), "file-unstaged-new.txt")); await settle();
  assert.equal(page.open, null);
  assert.deepEqual(state.violations, []);
});

test("rows of the virtual list draw without handlers and with token colors; the header counts", async () => {
  const r = repo(({ write, git }) => { write("a.js", "const a = 1;\n\tconst b = 2;\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  r.write("a.js", "const a = 10;\n\tconst b = 2;\nconst c = 3;\n");
  const view = await mount(r.dir), page = view.part;
  let tree = await draw(view);
  handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: 500, height: 400 }, makeCx());
  tree = await draw(view);
  const [list] = lists(tree).filter((l) => l.listId === "changes-diff");
  assert.equal(list.count, page.diff.items.length);
  const rows = renderRows(list);
  assert.equal(rows.length, list.count);
  assert.deepEqual(state.violations, []);
  const added = page.diff.rows.find((x) => x.kind === "+" && x.text.startsWith("const c"));
  assert.ok(added.spans.some((s) => s.cls === "keyword" && s.text === "const"), "tokens");
  assert.match(textOf(tree), /\+2/); assert.match(textOf(tree), /−1/);
  assert.match(textOf(byId(tree, "changes")), /1 file/);
});

test("Stage and Unstage on a row, Stage all and Unstage all", async () => {
  const r = twice(), view = await mount(r.dir), page = view.part;
  let tree = await draw(view);
  press(byId(tree, "stage-unstaged-b.txt")); await settle();
  assert.match(r.git("status", "--porcelain"), /^M  b\.txt$/m);
  tree = await draw(view);
  press(byId(tree, "stage-staged-b.txt")); await settle();
  assert.match(r.git("status", "--porcelain"), /^ M b\.txt$/m);
  // A deletion stages too.
  r.write("b.txt", "b\n"); r.git("add", "b.txt"); r.git("commit", "-qm", "b");
  const { rmSync } = await import("node:fs"); rmSync(`${r.dir}/b.txt`);
  await page.refresh(makeCx("async")); await settle();
  press(byId(await draw(view), "stage-unstaged-b.txt")); await settle();
  assert.match(r.git("status", "--porcelain"), /^D  b\.txt$/m);
  tree = await draw(view);
  press(byId(tree, "stage-all")); await settle();
  assert.equal(page.allStaged(), true);
  tree = await draw(view);
  assert.match(textOf(byId(tree, "stage-all")), /Unstage all/);
  press(byId(tree, "stage-all")); await settle();
  assert.equal(page.hasStaged(), false);
  assert.deepEqual(state.violations, []);
});

test("commit: only what is staged; nothing staged asks first, then stages all; amend; the template", async () => {
  const r = twice(), view = await mount(r.dir), page = view.part;
  page.input.set_value("Partial");
  let tree = await draw(view);
  press(byId(tree, "commit")); await settle();
  assert.equal(r.git("log", "-1", "--format=%s").trim(), "Partial");
  assert.match(r.git("status", "--porcelain"), /^ M a\.txt$/m, "the unstaged edit stays");
  // Nothing staged: the first press asks.
  page.input.set_value("Everything");
  tree = await draw(view);
  press(byId(tree, "commit")); await settle();
  assert.equal(page.askStage, true);
  tree = await draw(view);
  assert.match(textOf(byId(tree, "commit")), /Stage all & commit/);
  press(byId(tree, "commit")); await settle();
  assert.equal(r.git("log", "-1", "--format=%s").trim(), "Everything");
  assert.equal(r.git("status", "--porcelain"), "");
  assert.equal(page.message, "");
  // Amend: the last message comes in; an empty change rewrites the message only.
  tree = await draw(view);
  press(byId(tree, "amend")); await settle();
  assert.equal(page.input.value(), "Everything");
  page.input.set_value("Everything, said better");
  press(byId(await draw(view), "commit")); await settle();
  assert.equal(r.git("log", "-1", "--format=%s").trim(), "Everything, said better");
  assert.equal(r.git("rev-list", "--count", "HEAD").trim(), "3");
  assert.equal(page.amend, false);
  // The settings' template fills an empty box; a box with only it doesn't commit.
  state.shared.set("git-enhanced.settings", { template: "feat: " });
  await draw(view); await settle();
  assert.equal(page.input.value(), "feat: ");
  r.write("c.txt", "c\n");
  await page.refresh(makeCx("async")); await settle();
  tree = await draw(view);
  assert.equal(handler(byId(tree, "commit"), "on_click"), undefined, "the template alone commits nothing");
  state.shared.delete("git-enhanced.settings");
  assert.deepEqual(state.violations, []);
});

test("Push reads Push ↑N, publishes without an upstream, and is off when up to date", async () => {
  const r = repo(({ write, git }) => { write("a", "a\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  const { execFileSync } = await import("node:child_process");
  const origin = tempDir("git-enhanced-origin-"); execFileSync("git", ["init", "-q", "--bare", origin]);
  r.git("remote", "add", "origin", origin);
  const view = await mount(r.dir), page = view.part;
  let tree = await draw(view);
  assert.match(textOf(byId(tree, "push")), /Publish/);
  press(byId(tree, "push")); await settle();
  assert.equal(r.git("rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/main");
  tree = await draw(view);
  assert.equal(handler(byId(tree, "push"), "on_click"), undefined, "up to date: nothing to push");
  r.write("a", "b\n"); r.git("commit", "-qam", "two");
  await page.refresh(makeCx("async")); await settle();
  tree = await draw(view);
  assert.match(textOf(byId(tree, "push")), /Push ↑1/);
  press(byId(tree, "push")); await settle();
  assert.equal(r.git("rev-parse", "origin/main").trim(), r.git("rev-parse", "HEAD").trim());
  assert.deepEqual(state.violations, []);
});

test("Revert a file, delete a new one, Revert all: each asks, and keeps a copy first", async () => {
  const r = twice(), view = await mount(r.dir), page = view.part;
  const answer = async (value) => {
    await settle();
    const spec = state.overlays.at(-1)?.props?.question;
    assert.ok(spec, "a question is open");
    const { answer: give } = await load("question.js");
    asOverlay(state.overlays.at(-1), () => give(spec.id, value));
    await settle();
    return spec;
  };
  let tree = await draw(view);
  press(byId(tree, "file-unstaged-b.txt"), "on_mouse_down");
  const menu = await answer("revert");
  assert.equal(menu.menu, true); assert.match(menu.items[0].label, /Revert changes/);
  const ask = await answer({ text: null, choice: null, checks: {}, files: [] });
  assert.match(ask.title, /Revert b\.txt\?/); assert.match(ask.detail, /A copy is kept/);
  assert.equal(r.read("b.txt"), "b\n");
  assert.match(r.git("for-each-ref", "--format=%(refname)"), new RegExp(`refs/${NAME}/discarded/`), "a copy kept first");
  tree = await draw(view);
  press(byId(tree, "file-unstaged-new.txt"), "on_mouse_down");
  assert.match((await answer("revert")).items[0].label, /Delete file/);
  assert.match((await answer({})).title, /Delete new\.txt\?/);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(`${r.dir}/new.txt`), false);
  tree = await draw(view);
  press(byId(tree, "revert-all"));
  assert.match((await answer({})).title, /Revert all uncommitted changes\?/);
  assert.equal(r.git("status", "--porcelain"), "");
  // Cancelled: nothing happens.
  r.write("b.txt", "again\n");
  await page.refresh(makeCx("async")); await settle();
  press(byId(await draw(view), "file-unstaged-b.txt"), "on_mouse_down");
  await answer("revert"); await answer(null);
  assert.equal(r.read("b.txt"), "again\n");
  assert.deepEqual(state.violations, []);
});

test("the top row fits a narrow panel: Ask about diff is its icon under 600 px; the scope box gives way; the gear stays", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  r.write("a.txt", "two\n");
  const calls = (n, m) => n.calls.filter(([c]) => c === m).map(([, a]) => a);
  for (const width of [368, 1300]) {
    const view = await mount(r.dir, { palette: "theme" }), page = view.part;
    page.size = { width, height: 900 };
    if (page.open?.path !== "a.txt") { page.pick("a.txt", "unstaged", makeCx()); await settle(); }
    const tree = await draw(view), ask = byId(tree, "ask-diff"), gear = byId(tree, "changes-settings-open");
    assert.ok(ask, `${width}: Ask about diff`);
    assert.deepEqual(ask.handlers.tooltip, [["Ask the space's agent about this file's diff"]]);
    const icons = []; walk({ $: ask }, (d) => { if (d.kind === "svg") icons.push(d.path); });
    if (width < 600) {
      assert.equal(textOf({ $: ask }), "", "narrow: no words");
      assert.equal(icons.length, 1); assert.match(icons[0], /message\.svg$/);
      assert.deepEqual(calls(ask, "accessibility_label"), [["Ask about diff"]]);
    } else {
      assert.equal(textOf({ $: ask }), "Ask about diff", "wide: its words");
      assert.equal(icons.length, 0);
    }
    assert.ok(calls(ask, "flex_none").length, "it keeps its width");
    // The gear: last in its icon buttons' row, which is last in the top row; never shrinking; the
    // scope box is what gives way.
    let gearRow = null; walk(tree, (d) => { if (!gearRow && d.children?.some((c) => c?.$?.id === "changes-settings-open")) gearRow = d; });
    assert.equal(gearRow.children.at(-1).$.id, "changes-settings-open", `${width}: the gear is last`);
    let row = null; walk(tree, (d) => { if (!row && d.children?.some((c) => c?.$ === gearRow)) row = d; });
    assert.equal(row.children.at(-1).$, gearRow, `${width}: the icon buttons last in the top row`);
    assert.ok(calls(gear, "flex_none").length);
    const scope = byId(tree, "scope-box");
    assert.ok(calls(scope, "min_w").some(([v]) => v === 0), "the scope box shrinks");
    assert.ok(scope.children.some((c) => c?.$ && calls(c.$, "truncate").length && calls(c.$, "min_w").some(([v]) => v === 0)), "its label truncates");
    for (const c of row.children) {
      const d = c?.$;
      if (!d || d.kind === "popover" || calls(d, "flex_1").length) continue;
      assert.ok(calls(d, "flex_none").length, `${width}: ${d.id ?? d.kind} keeps its width`);
    }
    assert.deepEqual(state.violations, []);
  }
});
