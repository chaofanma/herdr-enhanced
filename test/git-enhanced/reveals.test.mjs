// reveals.js: which copy takes a reveal request, and which section a file's diff opens in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";

const { takersFor, sectionFor } = await mod("reveals.js");

const copy = (name, kind, { tab = false, root = "/r", on = null, roots = [] } = {}) => ({ copy: name, kind, tab, root, on, roots });
const req = (page, root = "/r", on = null) => ({ root, on, page, path: "a.txt", at: 1 });
const who = (r, copies, inLayout = true) => takersFor(r, copies, inLayout).map((x) => `${x.copy}:${x.how}`);

test("the copies of the page's kind showing that repository take it, the panel's before a tab's", () => {
  const panel = copy("panel", "changes"), review = copy("review", "changes", { tab: true }), hist = copy("hist", "history");
  assert.deepEqual(who(req("changes"), [review, panel, hist]), ["panel:show"]);
  assert.deepEqual(who(req("changes"), [review, copy("elsewhere", "changes", { root: "/x" }), hist]), ["review:show"], "only a tab shows it");
  assert.deepEqual(who(req("history"), [panel, hist]), ["hist:show"]);
  // Another machine's repository of the same path isn't this one.
  assert.deepEqual(who(req("changes", "/r", "vps"), [panel, copy("vps", "changes", { on: "vps" })]), ["vps:show"]);
});

test("else a panel copy listing the repository switches to it; else it opens a tab", () => {
  const panel = copy("panel", "changes", { root: "/r", roots: ["/r", "/r/lib"] });
  assert.deepEqual(who(req("changes", "/r/lib"), [panel]), ["panel:pick"]);
  assert.deepEqual(who(req("changes", "/other"), [panel]), ["panel:tab"]);
  // A History tab of another repository can't: the History panel copy opens a tab.
  assert.deepEqual(who(req("history", "/other"), [copy("tab", "history", { tab: true, root: "/x" }), copy("hist", "history")]), ["hist:tab"]);
});

test("no copy of the page's kind: wait for the page's block to start, else a panel copy opens it as a tab", () => {
  const panel = copy("panel", "changes");
  assert.deepEqual(who(req("history"), [panel], true), [], "the layout has a History block: its copy takes it when it starts");
  assert.deepEqual(who(req("history"), [panel], false), ["panel:tab"]);
  assert.deepEqual(who(req("history"), [copy("review", "changes", { tab: true })], false), ["review:tab"], "only a tab copy: it does");
  assert.deepEqual(who(req("history"), [], false), [], "no copy at all: nobody");
});

test("sectionFor: unstaged, else staged, else the first section listing the file", () => {
  const rows = (...paths) => paths.map((path) => ({ f: { path } }));
  const sections = [{ key: "staged", rows: rows("a.txt", "b.txt") }, { key: "unstaged", rows: rows("a.txt") }, { key: "committed", rows: rows("c.txt") }];
  assert.equal(sectionFor(sections, "a.txt"), "unstaged");
  assert.equal(sectionFor(sections, "b.txt"), "staged");
  assert.equal(sectionFor(sections, "c.txt"), "committed");
  assert.equal(sectionFor(sections, "d.txt"), null);
});
