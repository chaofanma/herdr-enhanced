// One meaning, one icon, on the Changes and History pages, their dialogs and windows, and Files
// Enhanced: each test here is one of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { repo, mount, draw, byId, walk, press, settle, texts } from "./render/load.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sources = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".js")).map((f) => [`${dir}/${f}`, readFileSync(join(ROOT, dir, f), "utf8")]);
const CODE = [...sources("git-enhanced/mods/git-enhanced"), ...sources("files-enhanced/mods/files-enhanced"), ...sources("shared")];
// The lines of code (not comments) that match `re`.
const lines = (re) => CODE.flatMap(([file, text]) => text.split("\n").map((l, i) => [l, `${file}:${i + 1}`])).filter(([l]) => !/^\s*(\/\/|\/?\*)/.test(l) && re.test(l)).map(([, at]) => at);

// How an element looks: its calls, without the ones naming it or saying what it does, and its children.
function replay(fn) {
  const calls = [];
  const p = new Proxy({}, { get: (_t, m) => (...a) => { calls.push(`${String(m)}(${a.map((x) => JSON.stringify(x)).join(",")})`); return p; } });
  fn(p);
  return calls;
}
function look(d) {
  const out = [];
  for (const [m, a] of d.calls) {
    if (["id", "tooltip", "child", "children", "role", "accessibility_label"].includes(m) || /^on_/.test(m)) continue;
    out.push(m === "hover" ? `hover(${replay(a[0]).join(".")})` : `${m}(${a.map((x) => JSON.stringify(x)).join(",")})`);
  }
  return out;
}
const svgOf = (d) => { let p = null; walk({ $: d }, (x) => { if (x.kind === "svg") p ??= [x.path, x.calls]; }); return p; };

test("Close: every close button is an icon button with Herdr's x; none draws × or ✕ as text", async () => {
  assert.deepEqual(lines(/(\.child\(|button\((t, )?"[^"]+", |link\("[^"]+", )"(×|✕)"/), [], "× or ✕ drawn as a button's text");
  // History's lines (an action that failed, a slow log): their close is the gear's look with Herdr's x.
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  const view = await mount(r.dir, { palette: "theme", view: "history" }), h = view.part.history;
  h.line = "Fetch failed: no remote";
  const tree = await draw(view), close = byId(tree, "history-line-close"), gear = byId(tree, /^history-settings-/);
  assert.ok(close, "the line's close");
  assert.deepEqual(look(close), look(gear), "drawn as the gear");
  assert.deepEqual(svgOf(close), ["mods/workspace-chrome/x.svg", [["size", [14]]]]);
  press(close); await settle();
  assert.equal(h.line, null, "it closes the line");
});

test("Ticks: a menu's mark and a tick box have the check icon, as the scope and branch boxes; no ✓ drawn as text", async () => {
  assert.deepEqual(lines(/["`]✓/), [], "✓ drawn as text");
  const { stubs, load } = await import("./render/load.mjs");
  const t = stubs.theme();
  for (const [file, name] of [["ui.js", "tick"], ["look.js", "tick"]]) {
    const mod = await load(file), on = mod[name](t, true), off = mod[name](t, false);
    const icon = svgOf(on.$);
    assert.ok(icon && /\/check\.svg$/.test(icon[0]), `${file} ${name}: the check icon (${icon?.[0]})`);
    assert.equal(svgOf(off.$), null, `${file} ${name}: none when off`);
  }
});

test("Drop-downs: every button or box that opens a menu ends with Herdr's chevron, 12 px; no ▾ drawn as text", async () => {
  assert.deepEqual(lines(/▾/), [], "▾ drawn as text");
  const { chevron, CHEVRON } = await import("../../shared/iconbutton.js");
  assert.equal(CHEVRON, "mods/workspace-chrome/chevron-down.svg");
  const mark = chevron();
  assert.equal(mark.$.kind, "svg"); assert.equal(mark.$.path, CHEVRON);
  assert.deepEqual(mark.$.calls.find(([m]) => m === "size"), ["size", [12]]);
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); });
  const view = await mount(r.dir, { palette: "theme", view: "history" });
  const tree = await draw(view);
  for (const [id, words] of [["history-branch", "main"], ["history-author", "Author"]]) {
    const d = byId(tree, id);
    assert.deepEqual(texts({ $: d }).map((w) => w.trim()).filter(Boolean), [words], `${id}: its words, no ▾`);
    assert.equal(svgOf(d)?.[0], CHEVRON, `${id}: Herdr's chevron`);
  }
  // Every other chevron in the code is the one helper's (the disclosure arrows of a folder aside).
  assert.deepEqual(lines(/chevron-down/).filter((at) => !/iconbutton\.js/.test(at)), [], "chevron-down drawn outside chevron()");
});

test("Writing the commit message: an agent writes it, so its button has sparkles; the pen is Rename's (Files' menu, Herdr's)", async () => {
  const r = repo(({ write, git }) => { write("a.txt", "one\n"); git("add", "-A"); git("commit", "-qm", "one"); write("a.txt", "two\n"); });
  const tree = await draw(await mount(r.dir, { palette: "theme" }));
  const pen = byId(tree, "commit-write");
  assert.ok(pen, "the button");
  assert.match(svgOf(pen)?.[0] ?? "", /\/sparkles\.svg$/);
  assert.deepEqual(lines(/square-pen/).filter((at) => at.startsWith("git-enhanced/")), [], "no pen on the Changes and History pages");
  const { items } = await import("../../files-enhanced/mods/files-enhanced/menu.js");
  const caps = { shell: true, zip: true, trash: "finder", write: true, os: "macos" };
  assert.equal(items({ root: "/r", on: null, rel: "a.txt", dir: false, found: null, caps }).find((x) => x?.label === "Rename…")?.icon, "square-pen");
});
