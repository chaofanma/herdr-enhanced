// The panel's settings (git-enhanced.settings: autoFetch, askStageAll, askAmendPushed, commitModel,
// template; herdr-enhanced.agents) reach the page and the send dialog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, overlay, drawWith, renderNow, draw, byId, handler, press, texts, settle, makeCx, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const machine = await load("machine.js");
const { PROBE } = await load("scripts.js");
const SETTINGS = "git-enhanced.settings";
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "core.hooksPath", "/dev/null"); };
const fetches = () => state.execLog.filter(([c, a]) => c === "sh" && /git fetch/.test(a[1] ?? "")).length;

test("defaults, then the settings: template, no questions, auto fetch (quiet, a failure only in the tooltip), the pen's model", async () => {
  const base = tempDir("git-enhanced-settings-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  writeFileSync(join(A, "f.txt"), "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(base, "clone", "-q", "remote.git", "b"); const B = join(base, "b"); cfg(B);
  const subject = () => sh(A, "log", "-1", "--format=%s").trim();
  state.shared.delete(SETTINGS); state.everies.length = 0;
  let view = await mount(A, { palette: "theme" }), page = view.part;
  assert.equal(page.input.value(), "");
  assert.ok(state.everies.includes(30000), "the panel's copy looks for due fetches");
  writeFileSync(join(A, "f.txt"), "two\n");
  page.refresh(makeCx("async")); await settle();
  page.input.set_value("Second"); page.commit(makeCx()); await settle();
  assert.equal(page.askStage, true, "asks by default"); assert.equal(subject(), "First");
  page.commit(makeCx()); await settle();
  assert.equal(subject(), "Second");
  const before = fetches();
  page.autoFetch(makeCx()); await settle();
  assert.equal(fetches(), before, "autoFetch 0: never");
  state.shared.set(SETTINGS, { autoFetch: 1, askStageAll: false, askAmendPushed: false, commitModel: "x/y-model", template: "feat: " });
  view = await mount(A, { palette: "theme" }); page = view.part;
  assert.equal(page.input.value(), "feat: ");
  assert.equal(handler(byId(await draw(view), "commit"), "on_click"), undefined, "the template alone doesn't commit");
  writeFileSync(join(A, "f.txt"), "three\n");
  page.refresh(makeCx("async")); await settle();
  page.input.set_value("feat: third"); page.commit(makeCx()); await settle();
  assert.equal(page.askStage, false); assert.equal(subject(), "feat: third", page.line);
  assert.equal(page.input.value(), "feat: ", "the template again after a commit");
  sh(A, "push", "-q");
  page.refresh(makeCx("async")); await settle();
  page.toggleAmend(makeCx()); await settle();
  assert.equal(page.input.value(), "feat: third", "Amend fills in the last message, not the template");
  page.input.set_value("feat: third, reworded"); page.commit(makeCx()); await settle();
  assert.equal(page.askPushed, false); assert.equal(subject(), "feat: third, reworded");
  assert.equal(page.input.value(), "feat: ");
  page.toggleAmend(makeCx()); await settle(); page.toggleAmend(makeCx()); await settle();
  assert.equal(page.input.value(), "feat: ", "Amend off unchanged: the template back");
  // autoFetch: a commit pushed elsewhere shows as Pull ↓1, with no busy state and no line.
  sh(A, "push", "-q", "-f");
  writeFileSync(join(B, "g.txt"), "from b\n"); sh(B, "pull", "-q", "--rebase"); sh(B, "add", "-A"); sh(B, "commit", "-qm", "From B"); sh(B, "push", "-q");
  page.refresh(makeCx("async")); await settle();
  assert.equal(page.facts.behind, 0);
  page.autoFetch(makeCx());
  assert.equal(page.busy, null, "no busy state");
  await settle();
  assert.equal(page.facts.behind, 1); assert.equal(page.line, null);
  const n = fetches();
  page.autoFetch(makeCx()); await settle();
  assert.equal(fetches(), n, "not due again within the minute");
  sh(A, "remote", "set-url", "origin", join(base, "missing.git"));
  page.fetched.clear(); page.autoFetch(makeCx()); await settle();
  assert.equal(page.line, null); assert.ok(page.fetchError);
  assert.match(byId(await draw(view), "fetch").handlers.tooltip.at(-1)[0], /last automatic fetch failed/);
  sh(A, "remote", "set-url", "origin", join(base, "remote.git"));
  // commitModel reaches the pen's command.
  machine.forget();
  let pen = null;
  state.execHook = (cmd, args) => {
    if (cmd === "sh" && args[1] === PROBE) return { code: 0, stdout: "Darwin\n1048576\ngit\npi\n", stderr: "" };
    if (cmd === "sh" && /-pen\.XXXXXX/.test(args[1])) { pen = args.slice(3); return { code: 0, stdout: "", stderr: "" }; }
    return null;
  };
  writeFileSync(join(A, "f.txt"), "four\n");
  page.refresh(makeCx("async")); await settle();
  page.writeMessage(makeCx()); await settle();
  state.execHook = null; machine.forget();
  assert.equal(pen[pen.indexOf("--model") + 1], "x/y-model");
  // The template changed in the settings: an untouched box follows; a typed one stays.
  state.shared.set(SETTINGS, { template: "fix: " });
  page.input.set_value("feat: ");
  await draw(view); await settle();
  assert.equal(page.input.value(), "fix: ");
  page.input.set_value("fix: typed");
  state.shared.set(SETTINGS, { template: "chore: " });
  await draw(view); await settle();
  assert.equal(page.input.value(), "fix: typed");
  state.everies.length = 0;
  await mount(A, { review: true, root: A });
  assert.ok(!state.everies.includes(30000), "a Review tab doesn't fetch by itself");
  // Another folder shown while rendering: the page starts over, without notifying from the render.
  view = await mount(A, { palette: "theme" }); page = view.part;
  state.focused = { ...state.focused, cwd: B }; state.panes = [{ pane: "p1", cwd: B }];
  renderNow(view); await settle();
  assert.equal(page.root, B);
  state.shared.delete(SETTINGS);
  assert.deepEqual(state.violations, []);
});

test("the send dialog starts the settings' agent: right of the focused pane with the question as its argument, or in a new tab", async () => {
  state.shared.set("herdr-enhanced.agents", { name: "claude", argv: ["claude"], where: "right" });
  state.agents = [];
  state.focused = { space: "s1", tab: "t1", pane: "p1", terminal: "t1", cwd: "/tmp" };
  const { view: dialog, props } = overlay({ props: { role: "send", send: { title: "f.txt · line 1", context: "the lines" } } });
  const tree = drawWith(dialog, props);
  assert.ok(texts(tree).some((s) => /starts claude right of the focused pane/.test(s)));
  assert.ok(texts(tree).includes("Start claude"));
  state.runs.length = 0;
  state.props = props; dialog.part.send(makeCx());
  assert.deepEqual(state.runs[0], ["terminal.open", { argv: ["claude", "the lines"], place: "right" }]);
  state.shared.set("herdr-enhanced.agents", { name: "pi", argv: ["pi", "--model", "m"] });
  state.runs.length = 0;
  dialog.part.send(makeCx());
  assert.deepEqual(state.runs[0], ["tab.new", { space: "s1", argv: ["pi", "--model", "m"], task: "the lines" }]);
  state.shared.delete("herdr-enhanced.agents"); state.props = {};
  assert.deepEqual(state.violations, []);
});
