// Loads mod modules with the stubbed Herdr modules (stubs.mjs), as render.test.mjs does, plus helpers
// for walking what a render described and for pressing its handlers.
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { MOD } from "../mod.mjs";
import { tempDir } from "../tmp.mjs";
import { layoutProblems } from "../../shared/layoutlint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(realpathSync(join(here, "more.mjs"))).href;
const FS = pathToFileURL(realpathSync(join(here, "fs.mjs"))).href;
registerHooks({ resolve(s, c, next) { return ["herdr", "gpui-kit", "gpui-base"].includes(s) ? { url: STUB, shortCircuit: true } : s === "fs/promises" ? { url: FS, shortCircuit: true } : next(s, c); } });

export const stubs = await import(STUB);
export const { state, makeCx, settle } = stubs;
// A module of the mod, e.g. await load("menu.js").
export const load = rel => import(pathToFileURL(join(MOD, rel)).href);

// A temp folder with these files (a name ending in "/" is an empty folder); its real path.
export function folder(names) {
  const d = tempDir();
  for (const n of names) {
    if (n.endsWith("/")) { mkdirSync(join(d, n), { recursive: true }); continue; }
    mkdirSync(dirname(join(d, n)), { recursive: true }); writeFileSync(join(d, n), n);
  }
  return d;
}
// The focused terminal is in dir (space s1 on this machine, or on `machine`: the stubs run its
// commands here all the same).
export function at(dir, machine = null) {
  state.spaces = [{ id: "s1", active: true, folder: dir, machine }];
  state.panes = [{ pane: "p1", cwd: dir }];
  state.focused = { space: "s1", tab: "t1", pane: "p1", terminal: machine ? `${machine}/t1` : "t1", cwd: dir };
}
// One render, with cx.notify() refused as Herdr does. Its tree is checked for layouts that fail on
// screen (layoutlint.mjs); what it finds goes into state.violations.
export function draw(view) {
  state.rendering = true;
  let tree;
  try { tree = view.render(makeCx()); } finally { state.rendering = false; }
  state.violations.push(...layoutProblems(tree));
  return tree;
}

// Every element under a rendered one (depth first), and the first whose id matches.
export function* walk(node) {
  if (!node?.$) return;
  yield node;
  for (const c of node.$.children) yield* walk(c);
}
export const byId = (root, id) => [...walk(root)].find(n => (id instanceof RegExp ? id.test(String(n.$.id)) : n.$.id === id)) ?? null;
export const allById = (root, re) => [...walk(root)].filter(n => re.test(String(n.$.id)));
// The text an element shows (its string children, all the way down).
export function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node?.$) return "";
  return node.$.children.map(text).join("");
}
// Calls an element's handler (on_click, on_mouse_down, on_key_down…) as GPUI would; returns the cx.
export function press(node, handler = "on_click", event = { click_count: 1, modifiers: {} }) {
  const hs = node?.$.handlers[handler];
  if (!hs?.length) throw new Error(`no ${handler} on ${node?.$.id ?? node?.$.kind}`);
  const cx = makeCx();
  for (const args of hs) args[args.length - 1](event, cx);
  return cx;
}
export const mods = (m = {}) => ({ shift: false, control: false, alt: false, platform: false, function: false, ...m });
export const key = (keystroke, k = keystroke.split("-").pop()) => ({ key: k, keystroke, modifiers: mods() });
