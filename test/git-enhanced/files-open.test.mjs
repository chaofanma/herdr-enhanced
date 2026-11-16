// Images in the diff (before and after, with their sizes; from another machine as base64) and a
// right-click on a diff line (Ask, or Open at line N, here or over ssh). Nothing is really opened:
// the stubs' execHook catches the programs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { state, stubs, repo, mount, overlay, drawWith, draw, byId, lists, walk, texts, handler, press, settle, makeCx, load, asOverlay } from "./render/load.mjs";
import { NAME } from "./mod.mjs";

const machine = await load("machine.js");
const { answer } = await load("question.js");
const ascii = (s) => [...s].map((c) => c.charCodeAt(0)), u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const png = (w, h, tail) => Buffer.from([0x89, ...ascii("PNG\r\n\x1a\n"), 0, 0, 0, 13, ...ascii("IHDR"), ...u32(w), ...u32(h), ...ascii(tail)]);
const images = (tree) => { const out = []; walk(tree, (n) => { if (n.kind === "image") out.push(n.path); }); return out; };
const APP = stubs.APP_HOME;

for (const on of [null, "vps"]) {
  test(`images (${on ? "on another machine: fetched as base64" : "here"}): before | after with sizes; staged; new; an SVG's text diff`, async () => {
    rmSync(join(APP, "cache"), { recursive: true, force: true });
    const r = repo(({ dir, git }) => {
      writeFileSync(join(dir, "logo.png"), png(4, 3, "one")); writeFileSync(join(dir, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect/></svg>\n');
      git("add", "-A"); git("commit", "-qm", "images");
    });
    writeFileSync(join(r.dir, "logo.png"), png(40, 30, "two, bigger"));
    const view = await mount(r.dir, { palette: "theme" }, on), page = view.part;
    assert.equal(page.on, on);
    if (page.open?.path !== "logo.png") { page.pick("logo.png", "unstaged", makeCx()); await settle(); }
    assert.ok(page.picture?.copies, `copies: ${page.picture?.error}`);
    assert.deepEqual(page.picture.copies.before.size, { width: 4, height: 3 });
    assert.deepEqual(page.picture.copies.after.size, { width: 40, height: 30 });
    let tree = await draw(view);
    assert.ok(byId(tree, "changes-diff-box").calls.some(([m]) => m === "hidden"), "the diff gives way");
    let words = texts(byId(tree, "image-view"));
    assert.ok(words.includes("Before · index") && words.includes("After · working tree"));
    assert.ok(words.some((w) => /^4 × 3 · \d+ B$/.test(w)) && words.some((w) => /^40 × 30 · \d+ B$/.test(w)));
    const paths = images(tree);
    assert.equal(paths.length, 2);
    assert.ok(paths.every((p) => new RegExp(`^cache/${NAME}/[0-9a-f]{40}\\.png$`).test(p)), paths.join(" "));
    assert.ok(paths.every((p) => existsSync(join(APP, p))), "copied into the app's folder");
    if (on) assert.ok(state.execLog.some(([c, a]) => c === "sh" && /Sending an image needs base64/.test(a[1] ?? "")), "fetched with the base64 script");
    assert.equal(byId(tree, "image-text"), null);
    r.git("add", "logo.png");
    page.refresh(makeCx("async")); await settle();
    if (page.open?.section !== "staged") { page.pick("logo.png", "staged", makeCx()); await settle(); }
    words = texts(byId(await draw(view), "image-view"));
    assert.ok(words.includes("Before · HEAD") && words.includes("After · index"));
    writeFileSync(join(r.dir, "new.png"), png(2, 2, "new"));
    page.refresh(makeCx("async")); await settle();
    page.pick("new.png", "unstaged", makeCx()); await settle();
    words = texts(byId(await draw(view), "image-view"));
    assert.ok(words.includes("none (new file)") && words.some((w) => /^2 × 2 · /.test(w)));
    writeFileSync(join(r.dir, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle/></svg>\n');
    page.refresh(makeCx("async")); await settle();
    page.pick("icon.svg", "unstaged", makeCx()); await settle();
    assert.deepEqual(page.picture.copies.after.size, { width: 32, height: 32 });
    press(byId(await draw(view), "image-text"));
    tree = await draw(view);
    assert.equal(byId(tree, "image-view"), null);
    assert.ok(page.diff.rows.some((x) => x.kind === "+" && /circle/.test(x.text)));
    page.refresh(makeCx("async")); await settle();
    assert.equal(byId(await draw(view), "image-view"), null, "a refresh keeps the text diff");
    assert.deepEqual(state.violations, []);
  });
}

// The row's menu: right-click, then (optionally) one of its items.
async function rightClick(view, find, pick) {
  const page = view.part;
  if (page.open?.path !== "a.txt") { page.pick("a.txt", "unstaged", makeCx()); await settle(); }
  const i = page.diff.rows.findIndex(find), tree = await draw(view);
  handler(lists(tree).find((l) => l.listId === "changes-diff"), "on_item_secondary_click")(`r:${i}`, {}, makeCx());
  await settle();
  const spec = state.overlays.at(-1).props.question;
  if (pick) {
    const { view: menu, props } = overlay(state.overlays.at(-1));
    handler(byId(drawWith(menu, props), `menu-${pick}`), "on_click")({}, makeCx());
    await settle();
  }
  return spec;
}
function editorsHere(opened, found = "cli zed\ncli nvim\n") {
  machine.forget();
  state.execHook = (cmd, args) => {
    if (["open", "xdg-open", "zed", "code", "nvim", "myed"].includes(cmd)) { opened.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; }
    if (cmd === "sh" && /command -v/.test(args[1] ?? "") && /for c in/.test(args[1] ?? "")) return { code: 0, stdout: found, stderr: "" };
    return null;
  };
}
function lineRepo() {
  const body = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const r = repo(({ write, git }) => { write("a.txt", body.join("\n") + "\n"); write("gone.txt", "g\n"); git("add", "-A"); git("commit", "-qm", "init"); });
  const edited = [...body]; edited.splice(7, 2, "line 8 and 9, as one"); r.write("a.txt", edited.join("\n") + "\n");
  r.git("rm", "-q", "gone.txt");
  return r;
}

test("Open at line here: the system's app (no line), Zed at the line, Neovim in a pane; Ask; a deleted file", async () => {
  const r = lineRepo(), opened = [];
  editorsHere(opened);
  state.shared.delete("herdr-enhanced.open-with");
  const view = await mount(r.dir, { palette: "theme" }), page = view.part;
  let spec = await rightClick(view, (x) => x.kind === "+");
  assert.equal(spec.title, "a.txt · line 8");
  assert.deepEqual(spec.items.map((i) => [i.id, i.label, i.detail]), [["ask", "Ask about line 8…", "Sends it to the space's agent"], ["open", "Open at line 8", "the default app opens the file, not the line"], ["blame", "Blame line 8", "Who last changed it, and when"]]);
  await rightClick(view, (x) => x.kind === "+", "open");
  assert.deepEqual(opened.at(-1), ["open", join(r.dir, "a.txt")]);
  state.shared.set("herdr-enhanced.open-with", { line: "zed" });
  spec = await rightClick(view, (x) => x.kind === "-" && x.text === "line 9", "open");
  assert.equal(spec.items[0].label, "Ask about this removed line…"); assert.equal(spec.items[1].detail, "in Zed");
  assert.deepEqual(opened.at(-1), ["zed", `${join(r.dir, "a.txt")}:8`]);
  state.shared.set("herdr-enhanced.open-with", { line: "nvim" });
  await rightClick(view, (x) => x.kind === "@", "open");
  assert.deepEqual(state.runs.at(-1), ["terminal.open", { argv: ["nvim", "+5", join(r.dir, "a.txt")], folder: r.dir, place: "right" }]);
  await rightClick(view, (x) => x.kind === "+", "ask");
  assert.ok(state.overlays.at(-1).props.send, "the send dialog");
  assert.match(state.overlays.at(-1).props.send.context, /^In .*a\.txt, line 8 of the diff/);
  page.pick("gone.txt", "staged", makeCx()); await settle();
  const i = page.diff.rows.findIndex((x) => x.kind === "-"), tree = await draw(view);
  handler(lists(tree).find((l) => l.listId === "changes-diff"), "on_item_secondary_click")(`r:${i}`, {}, makeCx()); await settle();
  spec = state.overlays.at(-1).props.question;
  assert.deepEqual([spec.items[1].disabled, spec.items[1].detail], [true, "The file is deleted"]);
  asOverlay(state.overlays.at(-1), () => answer(spec.id, null)); await settle();
  page.pick("a.txt", "unstaged", makeCx()); await settle();
  assert.ok(texts(await draw(view)).includes("Click a line to comment · right-click: ask, or open at the line"));
  state.execHook = null; state.shared.delete("herdr-enhanced.open-with");
  assert.deepEqual(state.violations, []);
});

test("Open at line on another machine: Zed over ssh here, Neovim in a terminal there, the system's app can't", async () => {
  const r = lineRepo(), opened = [];
  editorsHere(opened);
  state.machines = [{ name: "vps", target: "me@vps.example" }];
  state.shared.delete("herdr-enhanced.open-with");
  const view = await mount(r.dir, { palette: "theme" }, "vps");
  let spec = await rightClick(view, (x) => x.kind === "+");
  assert.equal(spec.items[1].disabled, true);
  assert.match(spec.items[1].detail, /The default app is on this computer/);
  asOverlay(state.overlays.at(-1), () => answer(spec.id, null)); await settle();
  state.shared.set("herdr-enhanced.open-with", { line: "zed" });
  spec = await rightClick(view, (x) => x.kind === "+", "open");
  assert.equal(spec.items[1].detail, "in Zed (over ssh)");
  assert.deepEqual(opened.at(-1), ["zed", `ssh://me@vps.example${join(r.dir, "a.txt")}`]);
  state.shared.set("herdr-enhanced.open-with", { line: "nvim" });
  spec = await rightClick(view, (x) => x.kind === "+", "open");
  assert.equal(spec.items[1].detail, "in Neovim on vps");
  assert.deepEqual(state.runs.at(-1), ["terminal.open", { argv: ["nvim", "+8", join(r.dir, "a.txt")], folder: r.dir, place: "right" }]);
  // A program of your own: with a command for another machine it opens there over ssh; without, it can't.
  const mine = { id: "my-ed", name: "My Ed", kind: "app", for: "files", argv: ["myed", "{file}"], remote: { argv: ["myed", "--ssh", "{host}", "{file}:{line}"] } };
  editorsHere(opened, "cli zed\ncli nvim\ncli myed\n");
  state.shared.set("herdr-enhanced.open-with", { line: "my-ed", items: [mine] });
  const view2 = await mount(r.dir, { palette: "theme" }, "vps");   // a page looks for programs once in a while: a new one
  spec = await rightClick(view2, (x) => x.kind === "+", "open");
  assert.equal(spec.items[1].detail, "in My Ed (over ssh)");
  assert.deepEqual(opened.at(-1), ["myed", "--ssh", "me@vps.example", `${join(r.dir, "a.txt")}:8`]);
  const { remote: _, ...plain } = mine;
  state.shared.set("herdr-enhanced.open-with", { line: "my-ed", items: [plain] });
  spec = await rightClick(view2, (x) => x.kind === "+");
  assert.equal(spec.items[1].disabled, true);
  assert.equal(spec.items[1].detail, "My Ed can't open files on vps");
  asOverlay(state.overlays.at(-1), () => answer(spec.id, null)); await settle();
  state.execHook = null; state.machines = []; state.shared.delete("herdr-enhanced.open-with");
  assert.deepEqual(state.violations, []);
});
