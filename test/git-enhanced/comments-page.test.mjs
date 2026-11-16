// Comments on diff lines: the box (a line, a widened range, a hunk, the whole file), the cards, editing
// and deleting, drafts kept per repository and scope, Submit review and Ask through the send dialog,
// the key commands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, overlay, drawWith, draw, renderNow, byId, lists, renderRows, handler, press, texts, settle, makeCx, load } from "./render/load.mjs";

const { KEY } = await load("id.js");

function setup() {
  const r = repo(({ write, git }) => { write("a.js", "const a = 1;\nconst b = 2;\n\tconst c = 3;\n"); write("b.txt", "b\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  r.write("a.js", "const a = 11;\nconst b = 2;\n\tconst c = 33;\nconst d = 44;\n");
  r.write("b.txt", "b2\n");
  return r;
}

test("the comment box: a line, a range, a hunk; cards under the last row; edit, delete; the whole file; per scope", async () => {
  const r = setup();
  state.shared.delete(KEY.drafts);
  for (const width of [368, 1300]) {
    const view = await mount(r.dir, { palette: "theme" }), page = view.part, d = page.diff;
    page.size = { width, height: 900 };
    if (page.open?.path !== "a.js") { page.pick("a.js", "unstaged", makeCx()); await settle(); }
    let tree = await draw(view);
    handler(byId(tree, "changes-diff-rows"), "on_size_change")({ width: width - 2, height: 500 }, makeCx());
    tree = await draw(view);
    const plus = d.rows.findIndex((x) => x.kind === "+"), last = d.rows.findLastIndex((x) => x.kind === "+");
    page.clickRow(plus, makeCx());
    assert.deepEqual([page.composer.from, page.composer.to], [plus, plus]);
    page.clickRow(last, makeCx());
    assert.deepEqual([page.composer.from, page.composer.to], [plus, last], "another row widens the range");
    page.clickRow(plus + 1, makeCx());
    assert.deepEqual([page.composer.from, page.composer.to], [plus + 1, plus + 1], "a row inside keeps just that one");
    tree = await draw(view);
    // Narrow: docked under the diff; wide: over its top right.
    const box = byId(tree, "comment-box");
    assert.ok(box);
    assert.equal(box.calls.some(([m]) => m === "absolute"), width >= 600);
    page.noteBox.set_value("Looks odd");
    for (const h of page.noteBox.handlers.submit) h({}, makeCx());
    assert.equal(page.notes.length, 1); assert.equal(page.composer, null);
    assert.deepEqual(state.shared.get(KEY.drafts)[`:${r.dir}:work`].map((c) => c.text), ["Looks odd"], "kept in the shared drafts");
    tree = await draw(view);
    const card = d.items.findIndex((it) => it.kind === "extra");
    assert.ok(card > d.itemOf(plus + 1), "the card is under its row");
    const rows = renderRows(lists(tree).find((l) => l.listId === "changes-diff"));
    assert.ok(texts(rows[card]).includes("Looks odd"));
    assert.deepEqual(state.violations, []);
    // A click on the card edits it; Save changes it; Delete removes it.
    handler(lists(tree).find((l) => l.listId === "changes-diff"), "on_item_click")(d.items[card].key, makeCx());
    assert.equal(page.composer.editing, page.notes[0].id);
    assert.equal(page.noteBox.value(), "Looks odd");
    page.noteBox.set_value("Looks odd, really");
    press(byId(await draw(view), "comment-add"));
    assert.equal(page.notes[0].text, "Looks odd, really");
    handler(lists(await draw(view)).find((l) => l.listId === "changes-diff"), "on_item_click")(d.items[d.items.findIndex((it) => it.kind === "extra")].key, makeCx());
    press(byId(await draw(view), "comment-delete"));
    assert.equal(page.notes.length, 0);
    // A @@ row: its whole hunk. The bubble: the whole file, with the change in words.
    page.clickRow(d.hunks[0], makeCx());
    assert.equal(d.rows[page.composer.from].kind === "@", false, "starts after the @@ row");
    page.closeBox(makeCx());
    press(byId(await draw(view), "comment-on-unstaged-b.txt"));
    assert.equal(page.composer.from, null);
    page.noteBox.set_value("Why b2?"); page.addNote(makeCx());
    assert.equal(page.notes[0].about, "modified, +1 −1");
    // Another scope has its own drafts.
    if (page.facts?.parent) { page.setScope("last", makeCx()); await settle(); assert.equal(page.notes.length, 0); page.setScope("work", makeCx()); await settle(); }
    assert.equal(page.notes.length, 1);
    page.setNotes([], makeCx());
  }
  assert.deepEqual(state.violations, []);
});

test("Submit review: one message to the send dialog; sent, the drafts go; Discard; Ask about diff; the key commands", async () => {
  const r = setup();
  state.shared.delete(KEY.drafts);
  const view = await mount(r.dir, { palette: "theme" }), page = view.part, d = page.diff;
  if (page.open?.path !== "a.js") { page.pick("a.js", "unstaged", makeCx()); await settle(); }
  const plus = d.rows.findIndex((x) => x.kind === "+");
  page.clickRow(plus, makeCx()); page.noteBox.set_value("First note"); page.addNote(makeCx());
  page.clickRow(d.rows.findLastIndex((x) => x.kind === "+"), makeCx()); page.noteBox.set_value("Second note"); page.addNote(makeCx());
  let tree = await draw(view);
  assert.match(texts(byId(tree, "drafts-submit"))[0], /Submit review · 2/);
  press(byId(tree, "drafts-submit"));
  const sent = state.overlays.at(-1).props.send;
  assert.match(sent.context, /^Review of .*: the uncommitted changes\. 2 comments\./);
  assert.match(sent.context, /### a\.js, line 1\n```\n1 \+ const a = 11;\n```\nComment: First note/);
  assert.equal(sent.sentKey, `:${r.dir}:work`);
  // The dialog sends it to the space's agent and says so; every copy drops the drafts.
  state.agents = [{ address: "t9", space: "s1", status: "idle", focused: false, program: { name: "pi" }, tab_name: "1" }];
  const sends = [];
  state.hcHook = (args) => (args[0] === "send" ? (sends.push(args), { code: 0, stdout: "", stderr: "" }) : null);
  const { view: dialog, props } = overlay(state.overlays.at(-1));
  state.props = props; dialog.part.note.set_value("Please look");
  dialog.part.send(makeCx()); await settle();
  state.props = { palette: "theme" };
  assert.deepEqual(sends[0].slice(0, 2), ["send", "t9"]);
  assert.match(sends[0][2], /^Please look\n\nReview of /);
  assert.deepEqual(state.runs.at(-1), ["agent.focus", { terminal: "t9" }]);
  await draw(view); await settle();
  assert.equal(page.notes.length, 0, "a sent review's drafts go");
  // A busy agent: Send anyway first, then forced.
  state.agents[0].status = "working";
  page.clickRow(plus, makeCx()); page.noteBox.set_value("Again"); page.addNote(makeCx());
  page.submit(makeCx());
  const second = overlay(state.overlays.at(-1));
  state.props = second.props;
  second.view.part.send(makeCx());
  assert.equal(second.view.part.confirm, true);
  assert.match(texts(drawWith(second.view, second.props)).join(" "), /Send anyway/);
  second.view.part.send(makeCx()); await settle();
  state.props = { palette: "theme" };
  assert.deepEqual(sends.at(-1).slice(0, 2), ["send", "--force"]);
  // Discard; Ask about diff.
  page.clickRow(plus, makeCx()); page.noteBox.set_value("Drop me"); page.addNote(makeCx());
  press(byId(await draw(view), "drafts-discard"));
  assert.equal(page.notes.length, 0);
  press(byId(await draw(view), "ask-diff"));
  assert.match(state.overlays.at(-1).props.send.context, /^The diff of .*a\.js \(unstaged changes/);
  // The key commands: <mod>.ask opens the dialog; <mod>.scope moves to the next scope.
  const before = state.overlays.length, [command] = state.commands.splice(0, 1);
  command("ask"); await settle();
  assert.equal(state.overlays.length, before + 1);
  assert.match(state.overlays.at(-1).props.send.context, /^The diff of /);
  state.hcHook = null; state.agents = [];
  assert.deepEqual(state.violations, []);
});
