// Agent turns on the page: a turn starts when an agent starts working and ends when it is done (the
// snapshots leave the person's index alone), its scope while it runs and after, the picker's rows,
// Revert this turn… (per file, later edits flagged) and Undo, two agents whose changes mix, pruning,
// a turn left open by a restart, turns on another machine, and when nothing is recorded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { state, repo, mount, overlay, drawWith, draw, byId, lists, renderRows, handler, press, texts, walk, settle, makeCx, load } from "./render/load.mjs";

const { KEY, REFS } = await load("id.js");
const SETTINGS = "git-enhanced.settings";
const byPopover = (tree, id) => { let hit = null; walk(tree, (n) => { if (n.popover === id) hit ??= n; }); return hit; };
const agent = (status, extra = {}) => ({ address: "t9", pane: "p9", space: "s1", tab: "t1", status, app: "pi", program: { name: "pi" }, ...extra });
const turns = () => state.shared.get(KEY.turns) ?? [];
// The recorders take turns by time (one claims the job until it hasn't checked for 10 s): each check
// here runs 11 s after the one before, so any recorder may take it.
let shift = 0;
async function later(ms, fn) { shift += ms; const real = Date.now, at = shift; Date.now = () => real() + at; try { return await fn(); } finally { Date.now = real; } }

test("a turn: started and ended by the agent's status, its scope, the picker, Revert this turn… and Undo", async () => {
  const r = repo(({ write, git }) => { write("keep.txt", "keep\n"); write("edit.txt", "one\n"); write("del.txt", "bye\n"); git("add", "-A"); git("commit", "-qm", "base"); });
  r.write("notes.txt", "untracked before the turn\n");
  r.write("staged.txt", "staged\n"); r.git("add", "staged.txt");
  const index = () => readFileSync(join(r.dir, ".git", "index"));
  state.shared.delete(KEY.turns); state.shared.delete(SETTINGS);
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  assert.ok(page.recorder, "the panel's copy records");
  state.panes = [...state.panes, { pane: "p9", cwd: r.dir }];
  const check = async () => { await later(11000, async () => { page.recorder.check(makeCx()); }); await settle(); };
  state.agents = [agent("idle")]; await check();
  assert.equal(turns().length, 0);
  state.agents = [agent("working")]; await check();
  assert.equal(turns().length, 1);
  const t1 = turns()[0];
  assert.equal(t1.agent, "pi"); assert.equal(t1.repo, `:${r.dir}`); assert.equal(t1.end, null); assert.equal(t1.skipped, null);
  assert.equal(r.git("rev-parse", `${REFS}turns/${t1.id}/start`).trim(), t1.start.commit);
  const before = index();
  r.write("edit.txt", "one\ntwo\n"); r.write("made.txt", "new\n"); rmSync(join(r.dir, "del.txt")); r.write("notes.txt", "changed by the agent\n");
  state.agents = [agent("blocked")]; await check();
  assert.equal(turns()[0].end, null, "blocked keeps it open");
  page.setScope("turn", makeCx(), t1.id); await settle();
  assert.equal(page.scope, "turn"); assert.ok(page.scopeSpan.running);
  assert.deepEqual(page.files.map((f) => [f.path, f.status]).sort(), [["del.txt", "D"], ["edit.txt", "M"], ["made.txt", "A"], ["notes.txt", "M"]]);
  assert.ok(page.scopeLabel().startsWith("Turn · pi"));
  state.agents = [agent("done")]; await check();
  const ended = turns()[0];
  assert.ok(ended.end && /^[0-9a-f]{40}$/.test(ended.end.commit), JSON.stringify(ended));
  assert.equal(ended.files, 4);
  assert.deepEqual(index(), before, "the snapshots leave the person's index alone");
  assert.equal(r.git("diff", "--cached", "--name-only").trim(), "staged.txt");
  page.setScope("work", makeCx()); await settle();
  let tree = await draw(view);
  handler(byPopover(tree, "scope"), "on_open_change")(true, makeCx());
  tree = await draw(view);
  assert.ok(texts(byId(tree, "scope-turn")).some((x) => /1 recorded here/.test(x)));
  press(byId(tree, "scope-turn")); await settle();
  tree = await draw(view);
  assert.match(texts(byId(tree, "scope-row-0")).join(" "), /^pi · \d\d:\d\d–\d\d:\d\d · 4 files/);
  press(byId(tree, "scope-row-0")); await settle();
  assert.equal(page.scope, "turn"); assert.equal(page.scopeTarget, ended.id);
  assert.equal(page.ref, ended.start.commit); assert.equal(page.to, ended.end.commit);
  assert.deepEqual(page.sections().map((s) => s.key), ["committed"]);
  assert.deepEqual(page.hunkActions(), []);
  assert.match(page.scopeWords(), /what pi's turn changed/);
  tree = await draw(view);
  assert.ok(byId(tree, "turn-revert"));
  renderRows(lists(tree).find((l) => l.listId === "changes-diff"));
  r.write("edit.txt", "one\ntwo\nlater edit\n");
  press(byId(tree, "turn-revert")); await settle();
  const spec = state.overlays.at(-1), p = spec.props.turnRevert;
  assert.ok(p, "the revert dialog");
  assert.deepEqual(p.plan.map((x) => [x.path, x.action]), [["del.txt", "restore"], ["edit.txt", "restore"], ["made.txt", "delete"], ["notes.txt", "restore"]]);
  assert.deepEqual(p.later, ["edit.txt"]);
  const dialog = overlay(spec), dt = drawWith(dialog.view, dialog.props), words = texts(dt).join(" | ");
  assert.match(words, /created by the turn: deleted/); assert.match(words, /changed since the turn ended/);
  const index2 = index(), saved = state.props;
  state.props = dialog.props; press(byId(dt, "turn-confirm")); await settle(); state.props = saved;
  assert.equal(dialog.view.part.error, null, String(dialog.view.part.error));
  assert.equal(r.read("edit.txt"), "one\n"); assert.equal(r.read("del.txt"), "bye\n");
  assert.equal(r.read("notes.txt"), "untracked before the turn\n"); assert.ok(!existsSync(join(r.dir, "made.txt")));
  assert.deepEqual(index(), index2, "the revert leaves the index alone");
  const reverted = turns().find((x) => x.id === ended.id).reverted;
  assert.ok(reverted?.undo && reverted.paths.length === 4);
  page.setScope("work", makeCx()); await settle();
  press(byId(await draw(view), "turn-note-undo")); await settle();
  assert.equal(r.read("edit.txt"), "one\ntwo\nlater edit\n", "Undo brings the later edit back too");
  assert.equal(r.read("made.txt"), "new\n"); assert.ok(!existsSync(join(r.dir, "del.txt")));
  assert.equal(r.read("notes.txt"), "changed by the agent\n");
  assert.equal(byId(await draw(view), "turn-note-undo"), null);
  assert.deepEqual(state.violations, []);
});

test("turns: two agents whose changes mix, pruning to turnsKeep, a turn a restart left open, another machine, nothing recorded", async () => {
  const r = repo(({ write, git }) => { write("keep.txt", "keep\n"); git("add", "-A"); git("commit", "-qm", "base"); });
  state.shared.delete(KEY.turns); state.shared.delete(SETTINGS);
  let view = await mount(r.dir, { palette: "theme" }), page = view.part;
  state.panes = [...state.panes, { pane: "p9", cwd: r.dir }, { pane: "p8", cwd: r.dir }];
  const check = async (p = page) => { await later(11000, async () => { p.recorder.check(makeCx()); }); await settle(); };
  const other = { address: "t8", pane: "p8", space: "s1", tab: "t1", status: "working", app: "codex", program: { name: "Codex" } };
  state.agents = [agent("working"), other]; await check();
  r.write("keep.txt", "keep\nboth\n");
  state.agents = [agent("idle"), { ...other, status: "done" }]; await check();
  assert.equal(turns().length, 2);
  let tree = await draw(view);
  handler(byPopover(tree, "scope"), "on_open_change")(true, makeCx());
  press(byId(await draw(view), "scope-turn")); await settle();
  tree = await draw(view);
  const rows = [0, 1].map((i) => texts(byId(tree, `scope-row-${i}`)).join(" "));
  assert.equal(rows.filter((x) => /their changes mix/.test(x) && /mixed/.test(x)).length, 2, JSON.stringify(rows));
  const oldest = turns().at(-1);
  state.shared.set(SETTINGS, { turnsKeep: 2 });
  state.agents = [agent("working")]; await check();
  state.agents = [agent("done")]; await check();
  assert.equal(turns().length, 2);
  await settle();
  assert.ok(!r.git("for-each-ref", "--format=%(refname)", REFS.slice(0, -1)).includes(oldest.id), "the pruned turn's refs go");
  state.shared.delete(SETTINGS);
  // A restart in a turn: the next recorder's first check ends it (and a new one starts).
  state.agents = [agent("working")]; await check();
  const open = turns()[0].id;
  view = await mount(r.dir, { palette: "theme" }); page = view.part;
  state.panes = [...state.panes, { pane: "p9", cwd: r.dir }];
  await check();
  assert.ok(turns().find((x) => x.id === open).end, "ended at the first check");
  assert.equal(turns()[0].end, null, "a new one for the agent still working");
  state.agents = [agent("idle")]; await check();
  // Another machine's agent: recorded there (its git and snapshots run on that machine).
  state.spaces = [...state.spaces, { id: "s2", machine: "vps", folder: r.dir }];
  const count = turns().length, ran = state.execLog.length;
  state.agents = [agent("working", { space: "s2" })]; await check();
  assert.equal(turns().length, count + 1);
  assert.equal(turns()[0].repo, `vps:${r.dir}`); assert.equal(turns()[0].on, "vps");
  assert.ok(state.execLog.slice(ran).every(([, , , on]) => on === "vps"), "everything ran on vps");
  state.agents = [agent("done", { space: "s2" })]; await check();
  assert.ok(turns()[0].end?.commit);
  // Off, or a folder that is no repository: nothing.
  const n = turns().length;
  state.shared.set(SETTINGS, { turns: false });
  state.agents = [agent("working")]; await check();
  assert.equal(turns().length, n);
  state.shared.delete(SETTINGS);
  state.agents = [agent("idle")]; await check();
  state.panes = state.panes.map((x) => (x.pane === "p9" ? { ...x, cwd: "/tmp" } : x));
  state.agents = [agent("working")]; await check();
  assert.equal(turns().length, n, "a folder that is no repository");
  // Only the panel's Changes copy records.
  assert.equal((await mount(r.dir, { palette: "theme", view: "history" })).part.recorder, undefined);
  assert.equal((await mount(r.dir, { palette: "theme", review: true, root: r.dir })).part.recorder, undefined);
  state.agents = [];
  assert.deepEqual(state.violations, []);
});
