// Patches and tags: Changes' ⋯ → Copy changes as patch ▸ and Apply a patch… (a plain patch and
// email patches), History's Copy › (message, patch, email patch) and Tag… (annotated, lightweight,
// a tag moved here), and a tag's menu saying what it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, overlay, drawWith, draw, byId, lists, handler, press, settle, makeCx } from "./render/load.mjs";
import { answer } from "./answers.mjs";

const commitsList = (tree) => lists(tree).find((l) => l.listId === "history-commits");
async function menuRow(view, hash, row) {
  handler(commitsList(await draw(view)), "on_item_secondary_click")(hash, {}, makeCx());
  const spec = state.overlays.at(-1), m = overlay(spec), tree = drawWith(m.view, m.props);
  const saved = state.props; state.props = m.props;
  press(byId(tree, `commit-${row}`));
  state.props = saved;
  await settle();
}

test("Changes ⋯: copy the unstaged changes as a patch, take them out, apply it again from the clipboard; email patches become commits", async () => {
  const r = repo(({ write, git }) => { write("f.txt", "a\nb\n"); git("add", "-A"); git("commit", "-qm", "init"); write("f.txt", "a\nB\n"); });
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  page.moreMenu(makeCx());
  await answer({ pick: "copy-patch" });
  await answer({ pick: "worktree" });
  const patch = state.clipboard.at(-1);
  assert.match(patch, /^diff --git a\/f\.txt b\/f\.txt\n/); assert.match(patch, /\n-b\n\+B\n/);
  r.git("checkout", "-q", "--", "f.txt");
  page.refresh(makeCx("async")); await settle();
  page.moreMenu(makeCx());
  await answer({ pick: "apply-patch" });
  let { spec } = await answer();
  assert.equal(spec.input.value, patch, "the clipboard's patch is in the box");
  assert.equal(state.overlays.findLast((o) => o.props?.question?.title === "Apply a patch").height, 560, "room for the text box at its 10 rows and the buttons");
  ({ spec } = await answer());
  assert.equal(spec.title, "Apply this patch to the working tree?"); assert.equal(spec.detail, "It changes f.txt.");
  assert.equal(r.read("f.txt"), "a\nB\n", page.line);
  // Email patches: a commit made elsewhere, made again here by git am.
  r.git("checkout", "-q", "--", "f.txt");
  r.git("switch", "-q", "-c", "other"); r.write("g.txt", "g\n"); r.git("add", "-A"); r.git("commit", "-qm", "Add g");
  const mail = r.git("format-patch", "--stdout", "-1"); r.git("switch", "-q", "main");
  state.clipboard.push(mail);
  page.refresh(makeCx("async")); await settle();
  page.moreMenu(makeCx()); await answer({ pick: "apply-patch" }); await answer();
  ({ spec } = await answer());
  assert.equal(spec.title, "Make a commit from these patches on the current branch, with their messages and authors?");
  assert.equal(r.git("log", "-1", "--format=%s").trim(), "Add g", page.line);
  assert.deepEqual(state.violations, []);
});

test("History: Copy › (message, patch, email patch), Tag… annotated then moved, the tag's menu", async () => {
  const r = repo(({ write, git }) => { write("f.txt", "a\n"); git("add", "-A"); git("commit", "-qm", "init"); write("f.txt", "b\n"); git("commit", "-qam", "Second\n\nBody."); });
  const second = r.git("rev-parse", "HEAD").trim(), first = r.git("rev-parse", "HEAD~1").trim();
  const view = await mount(r.dir, { palette: "theme", view: "history" }), h = view.part.history;
  await menuRow(view, second, "copy"); await answer({ pick: "message" });
  assert.equal(state.clipboard.at(-1), "Second\n\nBody.");
  await menuRow(view, second, "copy"); await answer({ pick: "patch" });
  assert.match(state.clipboard.at(-1), /^diff --git a\/f\.txt b\/f\.txt\n[\s\S]*\n-a\n\+b\n$/);
  await menuRow(view, first, "copy"); await answer({ pick: "patch" });
  assert.match(state.clipboard.at(-1), /new file mode 100644[\s\S]*\+a\n$/, "the root commit against nothing");
  await menuRow(view, second, "copy"); await answer({ pick: "email" });
  assert.match(state.clipboard.at(-1), new RegExp(`^From ${second} Mon Sep 17 00:00:00 2001\\n`));
  // Tag… on the first commit: no tag yet, so straight to the name; with a message: annotated.
  await menuRow(view, first, "tag");
  await answer({ set: (q) => q.input.set_value("v1") });
  await answer({ set: (q) => q.input.set_value("# One\nfirst release") });
  assert.equal(r.git("cat-file", "-t", "v1").trim(), "tag", h.line);
  assert.equal(r.git("tag", "-l", "--format=%(contents)", "v1").trim(), "# One\nfirst release", "a # line stays");
  // Move it to the second commit: asked.
  // Every other tag is listed (more than a menu's 12), each with Move here….
  for (let i = 0; i < 14; i++) r.git("tag", `old-${String(i).padStart(2, "0")}`, first);
  await menuRow(view, second, "tag");
  await answer({ pick: "move" });
  const list = await answer({ entry: 0 });
  assert.equal(list.spec.entries.length, 15);
  assert.deepEqual([list.spec.entries[0].title, list.spec.entries[0].button], ["v1", "Move here…"]);
  const { spec } = await answer();
  assert.equal(spec.title, `Move tag v1 from ${first.slice(0, 7)} to ${second.slice(0, 7)}?`); assert.equal(spec.danger, true);
  assert.equal(r.git("rev-parse", "v1^{commit}").trim(), second, h.line);
  // Its menu (a label of the second commit) says what it is.
  h.refMenu({ kind: "tag", name: "v1" }, makeCx());
  const menu = await answer({ cancel: true });
  assert.equal(menu.spec.items[0].label, "# One"); assert.equal(menu.spec.items[0].disabled, true);
  assert.deepEqual(state.violations, []);
});
