// Branches: the picker's right-click menu (rename, delete, merge, rebase), remote branches, Publish,
// and a stopped merge or rebase with its bar and Abort.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { state, mount, overlay, drawWith, draw, byId, handler, press, texts, settle, makeCx } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { sh(d, "config", "user.name", "t"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "core.hooksPath", "/dev/null"); };
async function answerLast(set = () => {}, { cancel = false, pick = null } = {}) {
  await settle();
  const spec = state.overlays.at(-1);
  assert.ok(spec?.props?.question, "a question was asked");
  const { view: q, props } = overlay(spec);
  set(q.part);
  const tree = drawWith(q, props);
  state.props = props;
  if (cancel) await q.close(); else handler(byId(tree, pick ? `menu-${pick}` : "question-confirm"), "on_click")({}, makeCx());
  state.props = { palette: "theme" };
  await settle();
  return { spec: spec.props.question, tree };
}
async function rightClick(view, name) {
  const page = view.part;
  page.openBranches(true, makeCx()); await settle();
  const tree = await draw(view), i = page.branches.findIndex((b) => b.name === name);
  assert.ok(i >= 0, `${name} listed`);
  const cx = makeCx();
  handler(byId(tree, `branch-${i}`), "on_mouse_down")({}, cx);
  assert.equal(cx.stopped, true);
}

test("branches: rename (asked again on a bad name), delete (-D after asking again), merge, rebase, abort, remotes, Publish", async () => {
  const base = tempDir("git-enhanced-branches-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a"); cfg(A);
  writeFileSync(join(A, "f.txt"), "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(base, "clone", "-q", "remote.git", "b"); const B = join(base, "b"); cfg(B);
  sh(B, "switch", "-q", "-c", "feature/r"); writeFileSync(join(B, "r.txt"), "r\n"); sh(B, "add", "-A"); sh(B, "commit", "-qm", "R"); sh(B, "push", "-q", "-u", "origin", "feature/r");
  sh(A, "fetch", "-q");
  sh(A, "switch", "-q", "-c", "side"); writeFileSync(join(A, "s.txt"), "s\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "S");
  sh(A, "switch", "-q", "main"); sh(A, "branch", "merged");
  sh(A, "switch", "-q", "-c", "clash"); writeFileSync(join(A, "f.txt"), "clash\n"); sh(A, "commit", "-qam", "Clash");
  sh(A, "switch", "-q", "main"); writeFileSync(join(A, "f.txt"), "main two\n"); sh(A, "commit", "-qam", "Main two");
  const branches = () => sh(A, "branch", "--format=%(refname:short)").trim().split("\n").sort();
  const view = await mount(A, { palette: "theme" }), page = view.part;
  page.openBranches(true, makeCx()); await settle();
  assert.deepEqual(page.branches.map((b) => [b.name, b.upstream]).sort(), [["clash", null], ["main", "origin/main"], ["merged", null], ["side", null]]);
  assert.deepEqual(page.remoteBranches.map((x) => x.name).sort(), ["origin/feature/r", "origin/main"]);
  let tree = await draw(view);
  assert.ok(texts(tree).includes("Remote branches"));
  assert.ok(texts(byId(tree, `remote-branch-${page.remoteBranches.findIndex((x) => x.name === "origin/main")}`)).some((x) => /local main/.test(x)));
  await rightClick(view, "main");
  let { spec } = await answerLast(() => {}, { cancel: true });
  assert.equal(spec.menu, true); assert.deepEqual(spec.items.map((i) => i.id), ["rename"]);
  await rightClick(view, "side");
  ({ spec } = await answerLast(() => {}, { pick: "rename" }));
  assert.deepEqual(spec.items.map((i) => i.label), ["Rename…", "Delete…", "Merge into main…", "Rebase main onto it…", "Merge into main ▸", "Rebase main onto it ▸"]);
  await answerLast((q) => q.input.set_value("bad..name"));
  ({ spec } = await answerLast((q) => q.input.set_value("side2")));
  assert.match(spec.error ?? "", /can't be a branch name/);
  assert.deepEqual(branches(), ["clash", "main", "merged", "side2"], page.line);
  await rightClick(view, "side2");
  await answerLast(() => {}, { pick: "delete" });
  ({ spec } = await answerLast()); assert.match(spec.title, /^Delete branch side2\?$/);
  ({ spec } = await answerLast()); assert.match(spec.title, /side2 is not fully merged/);
  assert.deepEqual(branches(), ["clash", "main", "merged"], page.line);
  await rightClick(view, "merged");
  await answerLast(() => {}, { pick: "delete" });
  const before = state.overlays.length;
  await answerLast();
  assert.equal(state.overlays.length, before, "merged: no second question");
  assert.deepEqual(branches(), ["clash", "main"]);
  // Merge: stops on the conflict; the bar's Abort asks too.
  await rightClick(view, "clash");
  await answerLast(() => {}, { pick: "merge" });
  ({ spec } = await answerLast());
  assert.equal(spec.title, "Merge clash into main?");
  assert.equal(page.operation, "merge", page.line);
  assert.match(page.line ?? "", /^Merge stopped on conflicts: CONFLICT/);
  tree = await draw(view);
  assert.deepEqual(texts(byId(tree, "operation-bar")), ["Merge stopped: 1 file conflict", "Continue", "Abort…"]);
  press(byId(tree, "operation-abort"));
  ({ spec } = await answerLast(() => {}, { cancel: true }));
  assert.equal(spec.title, "Abort the merge?"); assert.equal(page.operation, "merge", "cancelled");
  press(byId(tree, "operation-abort")); await answerLast();
  assert.equal(page.operation, null, page.line);
  assert.equal(readFileSync(join(A, "f.txt"), "utf8"), "main two\n");
  assert.equal(byId(await draw(view), "operation-bar"), null);
  // Rebase: stops; abort. One git won't start (uncommitted changes) says why.
  await rightClick(view, "clash");
  await answerLast(() => {}, { pick: "rebase" });
  ({ spec } = await answerLast());
  assert.equal(spec.title, "Rebase main onto clash?"); assert.match(spec.detail, /main is on origin\/main: after this they differ/);
  assert.equal(page.operation, "rebase", page.line);
  assert.equal(texts(byId(await draw(view), "operation-bar"))[0], "Rebase stopped (commit 1 of 1): 1 file conflict");
  page.abortOperation(makeCx()); await answerLast();
  assert.equal(page.operation, null);
  writeFileSync(join(A, "f.txt"), "dirty\n");
  page.refresh(makeCx("async")); await settle();
  await rightClick(view, "clash");
  await answerLast(() => {}, { pick: "rebase" });
  ({ spec } = await answerLast());
  assert.match(spec.detail, /won't start with uncommitted changes/);
  assert.match(page.line ?? "", /^Rebas(e|ing) failed: /);
  sh(A, "checkout", "-q", "--", "f.txt");
  sh(A, "switch", "-q", "-c", "ahead"); writeFileSync(join(A, "g.txt"), "g\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "Ahead"); sh(A, "switch", "-q", "main");
  page.refresh(makeCx("async")); await settle();
  await rightClick(view, "ahead");
  await answerLast(() => {}, { pick: "merge" }); await answerLast();
  assert.equal(sh(A, "log", "-1", "--format=%s").trim(), "Ahead", page.line);
  // A remote branch: a local one tracking it; again, the same local one.
  page.openBranches(true, makeCx()); await settle();
  page.remoteClick(page.remoteBranches.find((x) => x.name === "origin/feature/r"), makeCx()); await settle();
  assert.equal(sh(A, "branch", "--show-current").trim(), "feature/r", page.line);
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/feature/r");
  sh(A, "switch", "-q", "main");
  page.refresh(makeCx("async")); await settle();
  page.openBranches(true, makeCx()); await settle();
  page.remoteClick(page.remoteBranches.find((x) => x.name === "origin/feature/r"), makeCx()); await settle();
  assert.equal(sh(A, "branch", "--show-current").trim(), "feature/r"); assert.equal(page.line, null);
  // Publish.
  sh(A, "switch", "-q", "-c", "pub");
  page.refresh(makeCx("async")); await settle();
  tree = await draw(view);
  assert.deepEqual(texts(byId(tree, "push")), ["Publish"]);
  assert.match(byId(tree, "push").handlers.tooltip.at(-1)[0], /^Publish pub: git push -u origin HEAD/);
  press(byId(tree, "push")); await settle();
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "@{u}").trim(), "origin/pub", page.line);
  assert.deepEqual(texts(byId(await draw(view), "push")), ["Push"]);
  assert.deepEqual(state.violations, []);
});
