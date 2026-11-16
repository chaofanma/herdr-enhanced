// History's ⋯ › Worktrees… › Remove… (wtremove.js), as Herdr's own worktree mod does: what goes is read
// before its one question (uncommitted changes or untracked files make it forced) and again once it
// is answered (changes that came meanwhile get one more question); the space in that worktree is
// named there and closed first, only once the question is answered (a shell in the folder keeps it
// busy on Windows). git refusing for what isn't read before (a submodule) asks once more, forced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, press, settle, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const W = await load("worktrees.js");
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const cfg = (d) => { for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["core.hooksPath", "/dev/null"]]) sh(d, "config", k, v); };
function repo() {
  const base = realpathSync(tempDir("git-enhanced-wt-remove-")), A = join(base, "lantern");
  sh(base, "init", "-q", "-b", "main", "lantern"); cfg(A);
  writeFileSync(join(A, "f.txt"), "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First");
  sh(A, "worktree", "add", "-q", "-b", "clean", join(base, "wt-clean"));
  sh(A, "worktree", "add", "-q", "-b", "busy", join(base, "wt-busy"));
  writeFileSync(join(base, "wt-busy", "notes.txt"), "x\n");
  return { base, A };
}
// ⋯ › Worktrees… › the worktree whose label is `label` › Remove…
async function removeFrom(view, label) {
  press(byId(await draw(view), "history-more"));
  await answer({ pick: "worktrees" });
  await settle();
  const items = state.overlays.at(-1).props.question.items, item = items.find((x) => x.label === label);
  assert.ok(item, `${label} listed: ${items.map((x) => x.label)}`);
  await answer({ pick: item.id });
  await answer({ pick: "remove" });
}
const closes = () => state.runs.filter(([n]) => n === "space.close");

test("worktrees: the remove question says a space closes, and a forced one why", () => {
  const w = { path: "/r/wt", branch: "side", locked: false };
  assert.deepEqual(W.removeAsk(w, { space: { name: "side" } }), {
    title: "Remove the worktree at /r/wt?", confirm: "Remove", danger: true,
    detail: "Its folder goes; git refuses while it has uncommitted changes or untracked files. Its branch side stays. The space side closes first, with its terminals.",
  });
  const forced = W.removeAsk({ ...w, locked: true, lockReason: "usb" }, { dirty: false });
  assert.equal(forced.title, "Remove the worktree at /r/wt anyway?");
  assert.equal(forced.confirm, "Remove anyway");
  assert.match(forced.detail, /and it was locked \(usb\)\. Its branch side stays\.$/);
  assert.match(W.removeAsk(w, { dirty: true, space: { name: "" } }).detail, /The space in it closes first, with its terminals\.$/);
});

test("History › Worktrees… › Remove…: the space in it is named, closed only once answered, and a worktree with changes is asked about once", async () => {
  const { base, A } = repo();
  const view = await mount(A, { palette: "theme", view: "history" });
  state.spaces = [...state.spaces, { id: "s-clean", name: "clean", folder: join(base, "wt-clean"), machine: null, tabs: [] },
    { id: "s-busy", name: "busy", folder: join(base, "wt-busy"), machine: null, tabs: [] }];
  state.runs.length = 0;
  // Cancelled: nothing closes, nothing goes.
  await removeFrom(view, "clean");
  let { spec } = await answer({ cancel: true });
  assert.match(spec.detail, /The space clean closes first, with its terminals\.$/);
  assert.deepEqual(closes(), []);
  assert.equal(existsSync(join(base, "wt-clean")), true);
  // Answered: the space closes, then the worktree goes.
  await removeFrom(view, "clean");
  ({ spec } = await answer());
  assert.equal(spec.title, `Remove the worktree at ${join(base, "wt-clean")}?`);
  assert.deepEqual(closes(), [["space.close", { id: "s-clean", confirmed: true }]]);
  assert.equal(existsSync(join(base, "wt-clean")), false);
  // An untracked file: one question, forced; its space closes too.
  await removeFrom(view, "busy");
  ({ spec } = await answer());
  assert.equal(spec.title, `Remove the worktree at ${join(base, "wt-busy")} anyway?`);
  assert.match(spec.detail, /^Its uncommitted changes and untracked files are deleted with the folder\. Its branch busy stays\. The space busy closes first/);
  assert.deepEqual(closes().at(-1), ["space.close", { id: "s-busy", confirmed: true }]);
  assert.equal(existsSync(join(base, "wt-busy")), false);
  assert.equal(sh(A, "branch", "--list", "busy").trim(), "busy", "the branch stays");
  assert.deepEqual(state.violations, []);
});

test("History › Worktrees… › Remove…: changes that come while it is asked get one more question before the space closes", async () => {
  const { base, A } = repo(), wt = join(base, "wt-clean");
  const view = await mount(A, { palette: "theme", view: "history" });
  state.spaces = [...state.spaces, { id: "s-clean", name: "clean", folder: wt, machine: null, tabs: [] }];
  state.runs.length = 0;
  // Clean when asked; a file changes before the answer: asked again, declined: nothing closes or goes.
  await removeFrom(view, "clean");
  let { spec } = await answer({ set: () => writeFileSync(join(wt, "f.txt"), "edited\n") });
  assert.equal(spec.title, `Remove the worktree at ${wt}?`);
  ({ spec } = await answer({ cancel: true }));
  assert.equal(spec.title, `Remove the worktree at ${wt} anyway?`);
  assert.equal(spec.detail, "It changed since you were asked. Its uncommitted changes and untracked files are deleted with the folder. Its branch clean stays. The space clean closes first, with its terminals.");
  assert.deepEqual(closes(), []);
  assert.equal(existsSync(join(wt, "f.txt")), true);
  // Asked once now (it has changes), and gone.
  await removeFrom(view, "clean");
  ({ spec } = await answer());
  assert.equal(spec.title, `Remove the worktree at ${wt} anyway?`);
  assert.deepEqual(closes(), [["space.close", { id: "s-clean", confirmed: true }]]);
  assert.equal(existsSync(wt), false);
  assert.deepEqual(state.violations, []);
});

test("History › Worktrees… › Remove…: a submodule makes git refuse: asked once more, forced", async () => {
  const { base, A } = repo(), wt = join(base, "wt-clean"), S = join(base, "lib");
  sh(base, "init", "-q", "-b", "main", "lib"); cfg(S);
  writeFileSync(join(S, "l.txt"), "l\n"); sh(S, "add", "-A"); sh(S, "commit", "-qm", "Lib");
  sh(wt, "-c", "protocol.file.allow=always", "submodule", "add", "-q", S, "lib"); sh(wt, "commit", "-qm", "Add lib");
  assert.equal(sh(wt, "status", "--porcelain"), "", "clean");
  const view = await mount(A, { palette: "theme", view: "history" });
  await removeFrom(view, "clean");
  let { spec } = await answer();
  assert.equal(spec.title, `Remove the worktree at ${wt}?`);
  ({ spec } = await answer());
  assert.equal(spec.title, `Remove the worktree at ${wt} anyway?`);
  assert.match(spec.detail, /^git said: .*submodules.*\. Its uncommitted changes and untracked files are deleted with the folder\. Its branch clean stays\.$/);
  assert.equal(existsSync(wt), false);
  assert.equal(sh(A, "branch", "--list", "clean").trim(), "clean", "the branch stays");
  assert.deepEqual(state.violations, []);
});
