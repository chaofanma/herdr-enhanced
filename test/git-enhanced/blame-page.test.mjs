// Blame from a diff line's right-click (who, when, the commit shown, blame before this change) and
// History's Open this version (a copy here, opened by the stubbed system opener).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, utimesSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { state, repo, mount, draw, lists, byId, handler, settle, makeCx, load } from "./render/load.mjs";
import { answer } from "./answers.mjs";

test("Blame line N: the commit that last changed it, shown read-only, and the one before it", async () => {
  const r = repo(({ write, git }) => {
    write("f.txt", "a\nb\nc\n"); git("add", "-A"); git("commit", "-qm", "First");
    write("f.txt", "a\nB\nc\n"); git("commit", "-qam", "Second");
    write("f.txt", "a\nB\nc\nd\n");
  });
  const [second, first] = r.git("rev-list", "HEAD").trim().split("\n");
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  const i = page.diff.rows.findIndex((x) => x.kind === " " && x.text === "B");
  page.rowMenu(page.diff.items.find((it) => it.rows.includes(i)).key, makeCx());
  let { spec } = await answer({ pick: "blame" });
  assert.deepEqual(spec.items.map((x) => x.id), ["ask", "open", "blame"]);
  assert.equal(spec.items[2].label, "Blame line 2");
  ({ spec } = await answer({ pick: "before" }));
  assert.match(spec.title, new RegExp(`^${second.slice(0, 7)} · t · `));
  assert.equal(spec.items[0].label, "Second");
  ({ spec } = await answer({ pick: "show" }));
  assert.match(spec.title, new RegExp(`^${first.slice(0, 7)} · t · `), "before this change: the first commit");
  assert.equal(spec.items.find((x) => x.id === "before").disabled, true);
  await settle();
  assert.equal(page.scope, "commit"); assert.equal(page.scopeTarget, first);
  assert.deepEqual(state.violations, []);
});

test("History: a commit's file → Open this version writes it here and opens it", async () => {
  const r = repo(({ write, git }) => { write("f.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "First"); write("f.txt", "two\n"); git("commit", "-qam", "Second"); });
  const first = r.git("rev-parse", "HEAD~1").trim();
  const opened = [];
  state.execHook = (cmd, args) => (cmd === "open" || cmd === "xdg-open" ? (opened.push(args[0]), { code: 0, stdout: "", stderr: "" }) : null);
  try {
    const view = await mount(r.dir, { palette: "theme", view: "history" }), h = view.part.history;
    handler(lists(await draw(view)).find((l) => l.listId === "history-commits"), "on_item_click")(first, makeCx()); await settle();
    { const fl = lists(await draw(view)).find((l) => l.listId === "history-files-list"); handler(fl, "on_item_secondary_click")(fl.getKey(0), {}, makeCx()); }
    await answer({ pick: "version" });
    assert.equal(opened.length, 1, h.line);
    assert.match(opened[0], new RegExp(`/cache/git-enhanced/at-${first.slice(0, 7)}-[0-9a-f]{8}-f\\.txt$`));
    assert.equal(readFileSync(opened[0], "utf8"), "one\n");
    assert.deepEqual(state.violations, []);
  } finally { state.execHook = null; }
});

test("Open this version: two files of one name at one commit get two copies; the extension stays", async () => {
  const { versionName } = await load("blameui.js");
  const a = versionName("0123456789abcdef", "src/a/index.js"), b = versionName("0123456789abcdef", "src/b/index.js");
  assert.notEqual(a, b);
  assert.match(a, /^at-0123456-[0-9a-f]{8}-index\.js$/);
  assert.equal(versionName("0123456789", "src/a/index.js"), a.replace("0123456", "0123456"), "the same path, the same name");
  assert.match(versionName("0123456789", "docs/my notes (1).md"), /^at-0123456-[0-9a-f]{8}-my_notes__1_\.md$/);
});

test("Open this version's copies: the newest KEEP_VERSIONS stay, older ones go, nothing else is touched", async () => {
  // Before, every copy stayed in the app's cache folder for good.
  const { PRUNE_VERSIONS_SH, KEEP_VERSIONS, versionName } = await load("blameui.js");
  const dir = mkdtempSync(join(tmpdir(), "versions-"));
  try {
    const names = [];
    for (let i = 0; i < KEEP_VERSIONS + 5; i++) {
      const n = versionName("abcdef0123", `src/f${i}.txt`); names.push(n);
      writeFileSync(join(dir, n), String(i)); utimesSync(join(dir, n), 1700000000 + i, 1700000000 + i);
    }
    for (const other of ["a".repeat(40) + ".png", "notes.txt", "at-old-name.txt"]) { writeFileSync(join(dir, other), "x"); utimesSync(join(dir, other), 1600000000, 1600000000); }
    execFileSync("sh", ["-c", PRUNE_VERSIONS_SH, "sh", dir]);
    const left = new Set(readdirSync(dir));
    assert.deepEqual(names.filter((n) => left.has(n)), names.slice(5), "the newest stay");
    for (const other of ["a".repeat(40) + ".png", "notes.txt", "at-old-name.txt"]) assert.ok(left.has(other), `${other} isn't one of its copies`);
    assert.throws(() => execFileSync("sh", ["-c", PRUNE_VERSIONS_SH, "sh", "relative"], { stdio: "pipe" }), "only an absolute folder");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
