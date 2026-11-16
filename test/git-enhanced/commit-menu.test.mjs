// History's commit menu (right-click a commit): its rows in git's words, in groups:
// create a branch, a tag or a worktree here; Checkout commit…, Cherry-pick onto main…, Revert…;
// Reset main to here › and Interactive rebase ›, each a menu of its own; Show in Changes and the
// compares; Copy. The menu is as tall as what it draws: every row has a fixed height, the subject
// takes two lines at most (cut at a word, with "…"), and the popup asks for exactly that height (it
// asked for less than it drew, so its last row was cut off).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, load, mount, overlay, drawWith, draw, byId, lists, handler, press, settle, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const { menuItems, menuHeight, titleOf } = await load("commitmenu.js");
const { textCols } = await load("wrap.js");
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "Tess"); sh(d, "config", "user.email", "tess@x"); sh(d, "config", "core.hooksPath", "/dev/null"); };
const commit = (dir, file, text, msg) => { writeFileSync(join(dir, file), text); sh(dir, "add", "-A"); sh(dir, "commit", "-qm", msg); return sh(dir, "rev-parse", "HEAD").trim(); };
const LONG = "The layout entry's tab bar: a History button beside Files and Changes, and History a page of the panel";
const C = { sha: "1".repeat(40), short: "1111111", head: "2".repeat(40), branch: "main", refs: [], selected: null, site: null };
const rowsOf = (c) => menuItems(c).map((i) => (i === "-" ? "-" : i.heading ? `# ${i.heading}` : i.label));

test("its rows in git's words: create here, Checkout / Cherry-pick / Revert, Reset ›, Interactive rebase ›, show and compare, copy", () => {
  assert.deepEqual(rowsOf(C), [
    "Create branch here…", "Create tag here…", "Create worktree here…", "-",
    "Checkout commit…", "Cherry-pick onto main…", "Revert…", "-",
    "Reset main to here ›", "Interactive rebase ›", "-",
    "Show in Changes", "Compare with working tree", "-",
    "Copy SHA", "Copy ›",
  ]);
  const page = menuItems(C).filter((i) => i?.page).map((i) => i.id);
  assert.deepEqual(page, ["tag", "worktree", "reset", "rewrite", "copy"], "the rows the page goes on with: a menu or a dialog of its own");
  assert.ok(!menuItems(C).some((i) => i?.heading), "no heading: Reset's three are a menu of their own");
  assert.equal(rowsOf({ ...C, branch: null })[8], "Reset HEAD to here ›", "detached");
});

test("the subject on two lines at most: whole when it fits, else cut at a word with …", () => {
  assert.equal(titleOf("Short subject"), "Short subject");
  const t = titleOf(LONG);
  assert.ok(t.endsWith("…") && LONG.startsWith(t.slice(0, -1).trimEnd()), t);
  assert.ok(textCols(t) <= 70, `${textCols(t)} columns`);
  assert.ok(/\S…$/.test(t) && LONG[t.length - 1] === " ", `cut at a word: ${t}`);
  const wide = "ＡＢ ".repeat(30);   // full-width letters: two columns each
  assert.ok(textCols(titleOf(wide)) <= 70, "wide characters count twice");
  assert.equal(titleOf(""), "");
});

// The menu as drawn: [root, its children].
function drawMenu(c) {
  const m = overlay({ props: { commitMenu: c } });
  const tree = drawWith(m.view, m.props), root = byId(tree, "commit-overlay");
  return { tree, root, kids: root.children.map((k) => k.$) };
}
const call = (d, m) => d.calls.find(([k]) => k === m)?.[1];
// A child's height as drawn: a row's fixed h, a line's h plus its margins, the title's parts.
function heightOf(d) {
  const h = call(d, "h")?.[0], my = call(d, "my")?.[0] ?? 0;
  if (typeof h === "number") return h + 2 * my;
  const lines = d.children.map((x) => x.$);
  assert.ok(lines.length === 2, `the title: the subject and its hash (${d.id ?? d.kind})`);
  const px = (v) => Number(String(v).replace("px", ""));
  const [subject, hash] = lines;
  const subjectLine = px(call(subject, "line_height")[0]), hashLine = px(call(hash, "line_height")[0]);
  const max = call(subject, "max_h")?.[0];
  assert.equal(max, 2 * subjectLine, "the subject: two lines at most");
  assert.ok(call(subject, "whitespace_normal") && call(subject, "overflow_hidden"), "it wraps, and a third line is cut");
  return { top: call(d, "pt")[0], bottom: call(d, "pb")[0], subjectLine, hashLine };
}

test("the menu asks for what it draws: every row a fixed height, the title at most two lines of subject", () => {
  for (const [subject, lines] of [["Short subject", 1], [LONG, 2]]) {
    const c = { ...C, subject, names: { mod: "git-enhanced" } };
    const { root, kids } = drawMenu(c);
    const pad = call(root, "p")[0], gap = call(root, "gap")[0];
    let sum = 2 * pad + gap * (kids.length - 1);
    for (const d of kids) {
      const h = heightOf(d);
      if (typeof h === "number") { assert.ok(call(d, "flex_none"), `${d.id ?? d.kind}: never shrinks`); sum += h; }
      else sum += h.top + lines * h.subjectLine + h.hashLine + h.bottom;
    }
    assert.equal(menuHeight(menuItems(c), subject), sum, `${lines} line(s) of subject: the height asked is the height drawn`);
    // Every row's label truncates in the row (a long branch name doesn't push it out of the menu).
    for (const d of kids.filter((k) => /^commit-/.test(String(k.id)))) {
      const label = d.children.find((x) => x?.$)?.$;
      assert.ok(label && call(label, "truncate") && call(label, "min_w")?.[0] === 0, `${d.id}: its label truncates`);
    }
  }
});

test("the popup History opens asks for that height; Reset main to here › is a menu of Soft, Mixed and Hard, each opening its question", async () => {
  const base = tempDir("git-enhanced-cmenu-");
  sh(base, "init", "-q", "-b", "main", "a"); const A = join(base, "a"); cfg(A);
  commit(A, "f.txt", "one\n", "First");
  const second = commit(A, "g.txt", "g\n", LONG);
  commit(A, "h.txt", "h\n", "Third");
  const view = await mount(A, { palette: "theme", view: "history" });
  const list = lists(await draw(view)).find((l) => l.listId === "history-commits");
  handler(list, "on_item_secondary_click")(second, {}, makeCx());
  const spec = state.overlays.at(-1), m = spec.props.commitMenu;
  assert.equal(spec.kind, "popup");
  assert.equal(spec.height, menuHeight(menuItems(m), m.subject));
  // Reset main to here ›: the page asks which reset.
  const o = overlay(spec), saved = state.props;
  state.props = o.props;
  press(byId(drawWith(o.view, o.props), "commit-reset"));
  state.props = saved;
  await settle();
  const q = state.overlays.at(-1);
  assert.ok(q.props.question?.menu, "a menu");
  assert.equal(q.props.question.title, `Reset main to ${second.slice(0, 7)}`);
  assert.deepEqual(q.props.question.items.map((i) => [i.id, i.label, Boolean(i.danger)]), [
    ["soft", "Soft · keep changes staged…", false], ["mixed", "Mixed · keep changes unstaged…", false], ["hard", "Hard · discard changes…", true]]);
  const qv = overlay(q, "ov2");
  state.props = qv.props;
  press(byId(drawWith(qv.view, qv.props), "menu-mixed"));
  state.props = saved;
  await settle();
  const ask = state.overlays.at(-1);
  assert.equal(ask.kind, "dialog");
  assert.deepEqual([ask.props.commitAsk?.action, ask.props.commitAsk?.mode, ask.props.commitAsk?.sha], ["reset", "mixed", second]);
  assert.deepEqual(state.violations, []);
});
