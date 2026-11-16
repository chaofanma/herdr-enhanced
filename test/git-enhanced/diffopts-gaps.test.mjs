// The diff's options (whitespace and context from the settings, the ± control) and the "⋯ N lines"
// rows between hunks that bring more context.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, lists, renderRows, handler, press, texts, settle, makeCx, load, asOverlay } from "./render/load.mjs";

const { KEY } = await load("id.js");
const { answer } = await load("question.js");
const { alpha } = await load("look.js");
const { SAFE_ARGS } = await load("gittrust.js");
const SETTINGS = "git-enhanced.settings";
const diffList = (tree) => lists(tree).find((l) => l.listId === "changes-diff");
// git's arguments after SAFE_ARGS, which the page's own reads start with.
const bare = (a) => (a.slice(0, SAFE_ARGS.length).join("\0") === SAFE_ARGS.join("\0") ? a.slice(SAFE_ARGS.length) : a);
const diffCalls = () => state.execLog.filter(([c, a]) => c === "git" && bare(a)[0] === "diff" && a.includes("a.txt"));

test("whitespace and context: the ± control writes the settings, the diff is read again, hunk buttons follow", async () => {
  const body = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
  const r = repo(({ write, git }) => { write("a.txt", body.join("\n") + "\n"); git("add", "-A"); git("commit", "-qm", "init"); });
  const changed = [...body]; changed[4] = "line 5   "; changed[30] = "line 31 changed"; changed[50] = "  line 51";
  r.write("a.txt", changed.join("\n") + "\n");
  state.shared.delete(SETTINGS);
  const view = await mount(r.dir, { palette: "theme" }), page = view.part, d = page.diff;
  assert.deepEqual(page.open, { path: "a.txt", section: "unstaged" });
  assert.deepEqual(page.hunkActions().map((a) => a.id), ["stage", "revert"]);
  assert.equal(d.hunks.length, 3);
  let tree = await draw(view);
  assert.ok(byId(tree, "diff-options-box"));
  assert.ok(!diffCalls().at(-1)[1].some((a) => a === "-w" || /^-U/.test(a)), "git's own context by default");
  assert.deepEqual(diffCalls().at(-1)[1].slice(0, SAFE_ARGS.length), SAFE_ARGS, "read with SAFE_ARGS: no fsmonitor, no hooks");
  press(byId(tree, "diff-whitespace-off"));
  assert.deepEqual(state.shared.get(SETTINGS), { whitespace: true });
  await draw(view); await settle();
  assert.ok(diffCalls().at(-1)[1].includes("-w"));
  assert.equal(d.hunks.length, 1, "the whitespace-only hunks go");
  assert.deepEqual(page.hunkActions(), []); assert.equal(page.patch, null); assert.equal(page.hunksOff, true);
  tree = await draw(view);
  assert.ok(renderRows(diffList(tree)).flatMap((x) => texts(x)).includes("whitespace ignored · no Stage / Revert"));
  assert.match(byId(tree, "diff-whitespace-on").handlers.tooltip.at(-1)[0], /^Whitespace ignored/);
  page.reviewKey("s", makeCx());
  assert.equal(r.git("diff", "--cached", "--name-only").trim(), "", "no key stages a -w hunk either");
  state.shared.set(SETTINGS, { context: 10 });
  await draw(view); await settle();
  assert.ok(diffCalls().at(-1)[1].includes("-U10"));
  assert.equal(d.hunks.length, 2);
  assert.deepEqual(page.hunkActions().map((a) => a.id), ["stage", "revert"]);
  const ten = d.rows.length;
  state.shared.set(SETTINGS, { context: "file" });
  await draw(view); await settle();
  assert.ok(diffCalls().at(-1)[1].includes("-U1000000"));
  assert.equal(d.hunks.length, 1); assert.ok(d.rows.length > ten);
  page.hunk("stage", d.hunks[0], makeCx()); await settle();
  assert.match(r.git("diff", "--cached"), /line 31 changed/, "a whole-file hunk stages");
  page.choosingDiffOptions = true; tree = await draw(view);
  press(byId(tree, "diff-context-3"));
  assert.equal(state.shared.get(SETTINGS), null, "the defaults again: nothing stored");
  await draw(view); await settle();
  assert.deepEqual(state.violations, []);
});

test("gaps: a row says how many lines a gap hides; a click shows 20 more on each side; patches skip the rows", async () => {
  const body = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
  const r = repo(({ write, git }) => { write("a.txt", body.join("\n") + "\n"); git("add", "-A"); git("commit", "-qm", "init"); });
  const edited = [...body]; edited[9] = "line 10 changed"; edited[59] = "line 60 changed"; edited[99] = "line 100 changed";
  r.write("a.txt", edited.join("\n") + "\n");
  state.shared.delete(SETTINGS);
  let view = await mount(r.dir, { palette: "theme" }), page = view.part, d = page.diff;
  const gaps = () => d.rows.filter((x) => x.text.startsWith("⋯ ")).map((x) => x.text);
  assert.deepEqual(gaps(), ["⋯ 6 lines", "⋯ 43 lines", "⋯ 33 lines"]);
  assert.equal(d.hunks.length, 3); assert.equal(d.rows[0].text, "⋯ 6 lines");
  let tree = await draw(view);
  handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: 420, height: 600 }, makeCx());
  tree = await draw(view);
  const shown = renderRows(diffList(tree)).flatMap((x) => texts(x));
  assert.ok(shown.includes("⋯ 43 lines") && shown.includes("click: 20 more lines on each side"));
  assert.deepEqual(state.violations, []);
  page.hunk("stage", d.hunks[1], makeCx()); await settle();
  let cached = r.git("diff", "--cached");
  assert.match(cached, /\+line 60 changed/); assert.doesNotMatch(cached, /line 10 changed|line 100 changed/);
  r.git("reset", "-q"); page.refresh(makeCx("async")); await settle();
  // Revert… of the third hunk takes back only that one.
  page.hunk("revert", d.hunks[2], makeCx()); await settle();
  const q = state.overlays.at(-1).props.question;
  assert.match(q.detail, /^@@ -97,7 \+97,7 @@/);
  asOverlay(state.overlays.at(-1), () => answer(q.id, {})); await settle();
  assert.doesNotMatch(r.read("a.txt"), /line 100 changed/); assert.match(r.read("a.txt"), /line 60 changed/);
  r.write("a.txt", edited.join("\n") + "\n"); page.refresh(makeCx("async")); await settle();
  // A click on the middle gap: every gap shrinks by 40; the first hidden line comes to the middle.
  const k = d.rows.findIndex((x) => x.text === "⋯ 43 lines");
  state.execLog.length = 0;
  tree = await draw(view);
  handler(diffList(tree), "on_item_click")(`r:${k}`, makeCx()); await settle();
  assert.ok(state.execLog.some(([c, a]) => c === "git" && bare(a)[0] === "diff" && a.includes("-U23")));
  assert.deepEqual(gaps(), ["⋯ 3 lines"]);
  const at = d.rows.findIndex((x) => x.kind === " " && x.number === 14);
  assert.deepEqual(d.scroll.scrolled.at(-1), [d.itemOf(at), "center"]);
  assert.equal(page.composer, null, "a gap is no line to comment on");
  page.clickRow(d.rows.findIndex((x) => x.text === "⋯ 3 lines"), makeCx()); await settle();
  assert.deepEqual(gaps(), []); assert.equal(d.hunks.length, 1);
  page.hunk("stage", d.hunks[0], makeCx()); await settle();
  cached = r.git("diff", "--cached");
  assert.match(cached, /line 10 changed[\s\S]*line 60 changed[\s\S]*line 100 changed/, "the merged hunk stages whole");
  r.git("reset", "-q");
  // Side by side, a gap is a row across both halves and opens the same way.
  state.shared.set(KEY.layout, "split");
  view = await mount(r.dir, { palette: "theme", review: true, root: r.dir }); page = view.part; d = page.diff;
  if (page.open?.path !== "a.txt") { page.pick("a.txt", "unstaged", makeCx()); await settle(); }
  assert.deepEqual(gaps(), ["⋯ 6 lines", "⋯ 43 lines", "⋯ 33 lines"], "another copy starts at the settings' context");
  tree = await draw(view);
  handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: 1200, height: 700 }, makeCx());
  tree = await draw(view);
  renderRows(diffList(tree));
  const j = d.split.findIndex((s) => s.note != null && d.rows[s.note].text === "⋯ 6 lines");
  assert.ok(j >= 0);
  handler(diffList(tree), "on_item_click")(`s:${j}`, makeCx()); await settle();
  assert.deepEqual(gaps(), ["⋯ 3 lines"]);
  state.shared.delete(KEY.layout);
  assert.deepEqual(state.violations, []);
});

test("alpha: theme colors may carry their own alpha", () => {
  assert.equal(alpha("#ffffff18", 0.5), "#ffffff0c");
  assert.equal(alpha("#98c379", 0.16), "#98c37929");
  assert.equal(alpha("#abc", 1), "#aabbccff");
  assert.equal(alpha("red", 0.5), "red");
});
