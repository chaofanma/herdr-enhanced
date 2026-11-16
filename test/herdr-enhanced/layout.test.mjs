// The herdr-enhanced/ gallery entry: Herdr's own layout with a tab bar of its own (Herdr's, with a
// History button) and both mods' pages in its panel, its preview, and the mods it needs (copies of the
// two entries' own, made by tools/make-entry.mjs, checked by tools/check-copies.sh; the tab bar is the
// entry's own, tabs.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const entry = join(dirname(fileURLToPath(import.meta.url)), "../../herdr-enhanced");
const layout = JSON.parse(readFileSync(join(entry, "layouts/herdr-enhanced.json"), "utf8"));
// The mods of Herdr's own layout ("main") that ship with Herdr.
const SHIPPED = new Set(["workspace-chrome", "spaces", "agents", "pane", "workspace-status"]);
const OURS = new Set(["files-enhanced", "git-enhanced"]), TAB_BAR = "tabs-enhanced";

function* nodes(n) {
  if (!n || typeof n !== "object") return;
  yield n;
  for (const c of n.children ?? []) yield* nodes(c);
}
const byId = (id) => [...nodes(layout)].find((n) => n.id === id);
// Every mod a layout names: in blocks, a stack's header, a pane's header.
function modsIn(n, out = []) {
  if (Array.isArray(n)) n.forEach((x) => modsIn(x, out));
  else if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) { if (k === "mod" && typeof v === "string") out.push(v); else modsIn(v, out); }
  return out;
}

test("the entry: a layout, the mods it needs, their window keys, its README, RECIPE and preview, nothing else", () => {
  assert.deepEqual(readdirSync(entry).sort(), ["README.md", "RECIPE.md", "keys.json", "layouts", "mods", "preview.png"]);
  // The keys each mod's own entry has, together (mod.open: the mod in a window; again: closes it).
  const own = (m) => JSON.parse(readFileSync(join(entry, "..", m, "keys.json"), "utf8"));
  assert.deepEqual(own("files-enhanced"), { global: { "cmd-alt-f": "mod.open:files-enhanced" } });
  assert.deepEqual(own("git-enhanced"), { global: { "cmd-alt-g": "mod.open:git-enhanced" } });
  assert.deepEqual(JSON.parse(readFileSync(join(entry, "keys.json"), "utf8")), { global: { ...own("files-enhanced").global, ...own("git-enhanced").global } });
  // Each mod's mod.json makes mod.open open a window.
  for (const m of OURS) {
    const j = JSON.parse(readFileSync(join(entry, "mods", m, "mod.json"), "utf8"));
    assert.equal(j.place, "none"); assert.equal(j.overlay?.kind, "window"); assert.ok(j.title);
  }
  assert.deepEqual(readdirSync(join(entry, "layouts")).sort(), ["herdr-enhanced.json", "herdr-enhanced.svg"]);
  assert.deepEqual(readdirSync(join(entry, "mods")).sort(), ["files-enhanced", "git-enhanced", "tabs-enhanced"]);
  for (const m of OURS) for (const f of ["main.js", "mod.json", "id.js"]) assert.ok(existsSync(join(entry, "mods", m, f)), `${m}/${f}`);
  for (const f of ["main.js", "mod.json"]) assert.ok(existsSync(join(entry, "mods", TAB_BAR, f)), `${TAB_BAR}/${f}`);
});

test("Herdr's own layout with our tab bar: the panel's stack is the Files, Changes and History pages, no header", () => {
  assert.equal(layout.id, "root"); assert.equal(layout.type, "row");
  const ids = [...nodes(layout)].map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, "every id once");
  const panel = byId("panel");
  assert.equal(panel.type, "column"); assert.equal(panel.hidden, true, "opened from the tab bar, as in main");
  const stack = byId("panel-body");
  assert.equal(stack.type, "stack"); assert.equal(stack.active, "files");
  // The tab bar has the Files, Changes and History buttons: a header of ours would be a second row of tabs.
  assert.equal(byId("tabs").content.mod, TAB_BAR, "the tab bar with a History button");
  assert.equal(stack.header, undefined, "no header");
  assert.deepEqual(stack.children.map((c) => [c.id, c.title ?? null, c.type, c.content.mod, c.content.props ?? null]), [
    ["files", null, "block", "files-enhanced", null],
    ["changes", null, "block", "git-enhanced", { palette: "theme" }],
    ["history", null, "block", "git-enhanced", { palette: "theme", view: "history" }],
  ], "the ids the tab bar opens: files and changes (as Herdr's) and history");
  const named = new Set(modsIn(layout));
  for (const m of named) assert.ok(SHIPPED.has(m) || OURS.has(m) || m === TAB_BAR, `${m}: shipped with Herdr or in the entry`);
  for (const m of [...OURS, TAB_BAR]) assert.ok(named.has(m));
  assert.ok(!named.has("files") && !named.has("changes") && !named.has("tabs"), "Herdr's own Files, Changes and tab bar left out");
  const roles = [...nodes(layout)].filter((n) => n.content?.props?.role);
  assert.deepEqual(roles, [], "no part of ours with a role (a tab header) anywhere");
});

test("the layout's preview: its own SVG next to it, a picture of the window", () => {
  assert.equal(layout.preview, "layouts/herdr-enhanced.svg");
  const svg = readFileSync(join(entry, layout.preview), "utf8");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="640" height="400" viewBox="0 0 640 400"/);
  assert.match(svg.trim(), /<\/svg>$/);
  assert.doesNotMatch(svg, /<image|href=|<script|@import|url\(/, "self-contained: nothing fetched or run");
  for (const words of ["Files", "Changes", "History"]) assert.ok(svg.includes(`>${words}<`), words);
  // Neutral greys, one accent, and the diff's colors for added, removed and modified lines.
  const colors = new Set(svg.match(/#[0-9a-f]{6}\b/gi).map((c) => c.toLowerCase()));
  const grey = (c) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b) <= 12; };
  const ALLOWED = new Set(["#4f8cf7", "#3fb950", "#f85149", "#e3b341"]);
  assert.deepEqual([...colors].filter((c) => !grey(c) && !ALLOWED.has(c)), [], [...colors].join(" "));
  // The picture shows the Changes panel open, as the layout looks with it: the block's own switch,
  // a file list and a diff.
  for (const words of ["Stage", "Commit"]) assert.ok(svg.includes(`>${words}<`), words);
});
