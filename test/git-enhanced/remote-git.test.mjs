// Fetch, pull, branches, amend and the pen against a real bare remote; the Enter keys of the commit
// box (one commit per press, the comment box's own Enter). The pen's agent never runs: the stubs'
// execHook answers its script with a recorded pi run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, handler, press, texts, walk, settle, makeCx, load, asOverlay } from "./render/load.mjs";
import { REPO } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const machine = await load("machine.js");
const { PROBE } = await load("scripts.js");
// A button's words, then ▾ when it ends with Herdr's chevron (the drop-down's mark).
const said = (d) => { let mark = false; walk({ $: d.$ ?? d }, (x) => { if (x.kind === "svg" && x.path === "mods/workspace-chrome/chevron-down.svg") mark = true; }); return [texts(d).join(""), ...(mark ? ["▾"] : [])]; };
const OK = readFileSync(join(REPO, "test/git-enhanced/fixtures/pi-ok.jsonl"), "utf8");
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "core.hooksPath", "/dev/null"); };
function clones() {
  const base = tempDir("git-enhanced-remote-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  writeFileSync(join(A, "f.txt"), "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(base, "clone", "-q", "remote.git", "b"); const B = join(base, "b"); cfg(B);
  return { A, B };
}
// The agents "found" here, and the pen's script answered: it never starts one.
function agentsHere(found, answer = { code: 0, stdout: OK, stderr: "" }) {
  machine.forget();
  const calls = [];
  state.execHook = (cmd, args) => {
    if (cmd === "sh" && args[1] === PROBE) return { code: 0, stdout: `Darwin\n1048576\ngit\nbase64\n${found.join("\n")}\n`, stderr: "" };
    if (cmd === "sh" && /-pen\.XXXXXX/.test(args[1])) { calls.push(args.slice(3)); return answer; }
    return null;
  };
  return calls;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("Fetch, Pull ↓N, a pull that can't fast-forward, branches, switching, amend and a pushed amend", async () => {
  const { A, B } = clones();
  writeFileSync(join(B, "g.txt"), "two\n"); sh(B, "add", "-A"); sh(B, "commit", "-qm", "Second from B"); sh(B, "push", "-q");
  const view = await mount(A, { palette: "theme" }), page = view.part;
  let tree = await draw(view);
  assert.ok(byId(tree, "fetch")); assert.equal(byId(tree, /^pull-/), null);
  press(byId(tree, "fetch"));
  assert.equal(page.busy, "fetch");
  await settle();
  assert.equal(page.facts.behind, 1);
  tree = await draw(view);
  assert.deepEqual(said(byId(tree, "pull-behind-0-1")), ["Pull ↓1", "▾"], "the id names the counts its tooltip says");
  press(byId(tree, /^pull-behind-/));
  let { spec } = await answer({ pick: "ff-only" });
  assert.equal(spec.title, "1 commit to pull from origin/main");
  assert.equal(page.facts.behind, 0, page.line);
  assert.equal(readFileSync(join(A, "g.txt"), "utf8"), "two\n");
  // Diverged: fast-forward only is off and says why; rebasing asks first, uncommitted changes stashed around it.
  writeFileSync(join(A, "f.txt"), "one A\n"); sh(A, "commit", "-qam", "Local A");
  writeFileSync(join(B, "g.txt"), "two B\n"); sh(B, "commit", "-qam", "Remote B"); sh(B, "push", "-q");
  page.fetch(makeCx()); await settle();
  tree = await draw(view);
  assert.ok(byId(tree, "pull-diverged-1-1"));
  writeFileSync(join(A, "f.txt"), "one A, edited\n");
  page.pull(makeCx());
  ({ spec } = await answer({ pick: "rebase" }));
  assert.deepEqual(spec.items.map((i) => [i.id, Boolean(i.disabled), i.detail ?? null]).slice(0, 1), [["ff-only", true, "The branches have diverged: rebase or merge"]]);
  ({ spec } = await answer());
  assert.equal(spec.title, "Pull 1 commit and rebase main's 1 commit on top?");
  assert.equal(sh(A, "log", "--format=%s", "-3").trim(), "Local A\nRemote B\nSecond from B", page.line);
  assert.equal(readFileSync(join(A, "f.txt"), "utf8"), "one A, edited\n", "autostashed");
  sh(A, "checkout", "-q", "--", "f.txt");
  sh(A, "reset", "-q", "--hard", "origin/main");
  writeFileSync(join(A, "f.txt"), "three\n"); sh(A, "commit", "-qam", "Third");
  page.refresh(makeCx("async")); await settle();
  // Branches: a bad name is refused, a good one made and switched to; a click switches back.
  page.openBranches(true, makeCx()); await settle();
  tree = await draw(view);
  press(byId(tree, "branch-new"));
  assert.equal(page.newBranchOpen, true);
  page.branchInput.set_value("bad..name"); page.newBranch(makeCx()); await settle();
  assert.match(page.branchError ?? "", /can't be a branch name/);
  page.branchInput.set_value("feature/x"); page.newBranch(makeCx()); await settle();
  assert.equal(page.facts.branch, "feature/x");
  page.openBranches(true, makeCx()); await settle();
  tree = await draw(view);
  press(byId(tree, `branch-${page.branches.findIndex((b) => b.name === "main")}`)); await settle();
  assert.equal(page.facts.branch, "main");
  // A switch git refuses (a local change in the way) says why.
  sh(A, "switch", "-q", "feature/x"); writeFileSync(join(A, "f.txt"), "feature\n"); sh(A, "commit", "-qam", "On feature"); sh(A, "switch", "-q", "main");
  writeFileSync(join(A, "f.txt"), "dirty\n");
  page.refresh(makeCx("async")); await settle();
  page.switchTo("feature/x", false, makeCx()); await settle();
  assert.match(page.line, /^Switch(ing)? failed: /);
  sh(A, "checkout", "-q", "--", "f.txt");
  page.refresh(makeCx("async")); await settle();
  // Amend an unpushed commit: the last message comes in; off again, the draft comes back.
  page.input.set_value("typed draft");
  page.toggleAmend(makeCx()); await settle();
  assert.equal(page.amend, true); assert.equal(page.input.value(), "Third");
  page.toggleAmend(makeCx()); await settle();
  assert.equal(page.input.value(), "typed draft");
  page.toggleAmend(makeCx()); await settle();
  page.input.set_value("Third, reworded"); page.commit(makeCx()); await settle();
  assert.equal(sh(A, "log", "-1", "--format=%s").trim(), "Third, reworded");
  assert.equal(page.amend, false);
  // A pushed commit: the first press asks, the second amends.
  sh(A, "push", "-q");
  page.refresh(makeCx("async")); await settle();
  page.toggleAmend(makeCx()); await settle();
  page.input.set_value("Third, again"); page.commit(makeCx()); await settle();
  assert.equal(page.askPushed, true);
  assert.equal(sh(A, "log", "-1", "--format=%s").trim(), "Third, reworded");
  page.commit(makeCx()); await settle();
  assert.equal(sh(A, "log", "-1", "--format=%s").trim(), "Third, again");
  assert.deepEqual(state.violations, []);
});

test("the pen: the settings' agent writes into the box (never commits); one not found offers those that are", async () => {
  const { A } = clones();
  writeFileSync(join(A, "f.txt"), "four\n"); sh(A, "add", "f.txt");
  const calls = agentsHere(["pi", "codex"]);
  const view = await mount(A, { palette: "theme" }), page = view.part;
  let tree = await draw(view);
  press(byId(tree, "commit-write")); await settle();
  assert.equal(page.input.value(), "Add a todo item removal function");
  assert.equal(sh(A, "rev-list", "--count", "HEAD").trim(), "1", "nothing committed");
  const [args] = calls;
  assert.equal(args[1], "pi"); assert.ok(!args.includes("--model"), "no model set: pi's own default");
  assert.match(args.at(-1), /The staged diff[\s\S]*\+four/, "the staged diff in the prompt");
  // Claude Code chosen but not here: a menu of the agents found (pi, Codex), and the pick is kept.
  state.shared.set("git-enhanced.settings", { commitAgent: "claude" });
  press(byId(await draw(view), "commit-write")); await settle();
  const menu = state.overlays.at(-1).props.question;
  assert.deepEqual(menu.items.map((i) => i.id), ["pi", "codex"]);
  assert.match(menu.items[1].detail, /the diff goes to Codex's model provider/);
  const { answer } = await load("question.js");
  asOverlay(state.overlays.at(-1), () => answer(menu.id, "codex")); await settle();
  assert.equal(state.shared.get("git-enhanced.settings").commitAgent, "codex");
  assert.equal(calls.at(-1)[1], "codex", "codex wrote it");
  // Its tooltip says where the diff goes.
  tree = await draw(view);
  assert.match(byId(tree, "commit-write").handlers.tooltip[0][0], /Codex's model provider/);
  state.shared.delete("git-enhanced.settings"); state.execHook = null; machine.forget();
  assert.deepEqual(state.violations, []);
});

test("Enter in the commit box: a new line; cmd-enter commits once per press; the comment box takes its own", async () => {
  const { A } = clones();
  const body = () => sh(A, "log", "-1", "--format=%B").replace(/\n+$/, "");
  const view = await mount(A, { palette: "theme" }), page = view.part;
  let tree = await draw(view);
  assert.equal(page.input.kind, "textarea");
  let ta = null; walk(tree, (n) => { if (n.kind === "textarea" && n.state === page.input) ta = n; });
  assert.ok(ta, "a textarea in the commit bar");
  const keys = () => handler(byId(tree, "changes"), "on_key_down");
  const submit = (e) => { for (const h of page.input.handlers.submit) h(e, makeCx()); };
  const up = () => handler(byId(tree, "changes"), "on_key_up")({ key: "enter", modifiers: {} }, makeCx());
  const next = async () => { await wait(160); up(); };
  writeFileSync(join(A, "f.txt"), "two\n");
  page.refresh(makeCx("async")); await settle(); tree = await draw(view);
  for (const h of page.input.handlers.focus) h({}, makeCx());
  assert.equal(page.typing, true);
  const MSG = "Subject line\n\nSecond paragraph: it must survive.\n- and a list";
  page.input.set_value(MSG);
  submit({}); submit({ shift: true });
  assert.equal(page.askStage, false, "plain and shift Enter: a new line, nothing else");
  await next();
  submit({ secondary: true });
  assert.equal(page.askStage, true, "the first press asks");
  let cx = makeCx(); keys()({ key: "enter", modifiers: { platform: true } }, cx); await settle();
  assert.equal(cx.stopped, true); assert.equal(page.askStage, true); assert.equal(body(), "First", "the same press twice: still one question");
  await next();
  page.input.set_value(`${MSG}\n`);
  assert.equal(page.askStage, true, "cmd-enter's newline keeps the question");
  submit({ secondary: true }); await settle();
  assert.equal(body(), MSG, "committed once, every line kept");
  assert.equal(page.input.value(), "");
  // Held: its repeats answer nothing until the key goes up.
  writeFileSync(join(A, "f.txt"), "three\n");
  page.refresh(makeCx("async")); await settle(); tree = await draw(view);
  await next();
  page.input.set_value("Third"); submit({ secondary: true });
  assert.equal(page.askStage, true);
  await wait(230);
  for (let k = 0; k < 4; k++) { submit({ secondary: true }); keys()({ key: "enter", modifiers: { platform: true }, is_held: true }, makeCx()); await wait(30); }
  await settle();
  assert.equal(body(), MSG, "nothing committed by the repeats");
  page.input.set_value("Third, edited");
  assert.equal(page.askStage, false, "an edit takes the question back");
  // Naming a branch: cmd-enter isn't the page's.
  await next();
  for (const h of page.input.handlers.blur) h({}, makeCx());
  page.naming = true; cx = makeCx(); keys()({ key: "enter", modifiers: { platform: true } }, cx);
  assert.equal(cx.stopped, undefined); page.naming = false;
  // The comment box open: cmd-enter adds the comment once, and that press never commits.
  const plus = page.diff.rows.findIndex((r) => r.kind === "+");
  page.clickRow(plus, makeCx());
  assert.ok(page.composer);
  page.noteBox.set_value("A note");
  await next();
  for (const h of page.noteBox.handlers.submit) h({ secondary: true }, makeCx());
  assert.equal(page.notes.length, 1); assert.equal(page.composer, null);
  cx = makeCx(); keys()({ key: "enter", modifiers: { platform: true } }, cx); await settle();
  assert.equal(page.askStage, false, "the comment's press didn't reach Commit");
  // ctrl-enter from the root adds too, once.
  page.clickRow(plus, makeCx()); page.noteBox.set_value("Second note");
  await next();
  cx = makeCx(); keys()({ key: "enter", modifiers: { control: true } }, cx);
  assert.equal(cx.stopped, true); assert.equal(page.notes.length, 2);
  for (const h of page.noteBox.handlers.submit) h({}, makeCx());
  assert.equal(page.notes.length, 2, "no second add");
  // The box open but the message box has the keyboard: cmd-enter commits.
  page.clickRow(plus, makeCx());
  for (const h of page.input.handlers.focus) h({}, makeCx());
  await next();
  cx = makeCx(); keys()({ key: "enter", modifiers: { platform: true } }, cx);
  assert.equal(page.askStage, true); assert.ok(page.composer, "the comment box stays");
  page.closeBox(makeCx()); for (const h of page.input.handlers.blur) h({}, makeCx());
  page.setNotes([], makeCx());
  await next();
  cx = makeCx(); keys()({ key: "enter", modifiers: { platform: true } }, cx); await settle();
  assert.equal(body(), "Third, edited");
  // Amend with a message of several lines: it comes in whole, an edit keeps it.
  await next();
  writeFileSync(join(A, "f.txt"), "four\n"); sh(A, "commit", "-qam", "Four\n\nBody of four\nline two");
  page.refresh(makeCx("async")); await settle();
  page.input.set_value("draft"); page.toggleAmend(makeCx()); await settle();
  assert.equal(page.input.value(), "Four\n\nBody of four\nline two");
  page.input.set_value(`${page.input.value()}\nline three`); page.commit(makeCx()); await settle();
  assert.equal(body(), "Four\n\nBody of four\nline two\nline three");
  assert.equal(page.input.value(), "");
  assert.equal(state.overlays.filter((o) => o.props?.question?.title?.match(/push/i)).length, 0, "no push question");
  assert.deepEqual(state.violations, []);
});
