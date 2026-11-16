// Loads the mod with the stubbed Herdr modules (stubs.mjs; fs.mjs for fs/promises), plus helpers to
// walk what a render described, press its handlers and make temp repositories.
import "../../shared/no-outer-git.mjs";
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, realpathSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { MOD } from "../mod.mjs";
import { tempDir } from "../tmp.mjs";
import { layoutProblems } from "../../shared/layoutlint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(realpathSync(join(here, "stubs.mjs"))).href;
const FS = pathToFileURL(realpathSync(join(here, "fs.mjs"))).href;
registerHooks({ resolve(s, c, next) { return ["herdr", "gpui-kit", "gpui-base"].includes(s) ? { url: STUB, shortCircuit: true } : s === "fs/promises" ? { url: FS, shortCircuit: true } : next(s, c); } });

export const stubs = await import(STUB);
export const fsStub = await import(FS);
export const { state, makeCx, settle } = stubs;
// A module of the mod, e.g. await load("changes.js").
export const load = (rel) => import(pathToFileURL(join(MOD, rel)).href);
const { default: View } = await load("main.js");

// Walks recorded elements (`el.$`).
export function walk(node, fn) {
  const d = node?.$;
  if (!d) return;
  fn(d);
  for (const c of d.children ?? []) walk(c, fn);
}
export const byId = (tree, id) => { let hit = null; walk(tree, (n) => { if (hit === null && (id instanceof RegExp ? id.test(String(n.id)) : n.id === id)) hit = n; }); return hit; };
export const allById = (tree, re) => { const out = []; walk(tree, (n) => { if (re.test(String(n.id))) out.push(n); }); return out; };
export const lists = (tree) => { const out = []; walk(tree, (n) => { if (n.kind === "vlist") out.push(n); }); return out; };
export const texts = (node) => { const out = []; walk(node?.$ ? node : { $: node }, (n) => { for (const c of n.children ?? []) if (typeof c === "string") out.push(c); }); return out; };
export const textOf = (node) => texts(node).join(" ");
export function renderRows(list, range = { start: 0, end: list.count }) {
  state.inRenderer = true; state.rendering = true;
  let rows;
  try { rows = list.render(range, makeCx()); } finally { state.inRenderer = false; state.rendering = false; }
  for (const row of rows ?? []) state.violations.push(...layoutProblems(row));
  return rows;
}
// A handler of an element (the last one registered for `name`).
export const handler = (node, name) => (node?.$ ?? node)?.handlers?.[name]?.at(-1)?.at(-1);
export function press(node, name = "on_click", event = { click_count: 1, modifiers: {} }) {
  const h = handler(node, name);
  if (!h) throw new Error(`no ${name} on ${node?.id ?? node?.$?.id ?? node?.kind}`);
  const cx = makeCx();
  h(event, cx);
  return cx;
}

/** A temp repository: setup({ dir, git, write, read }) runs first. */
export function repo(setup = () => {}) {
  const dir = tempDir("git-enhanced-smoke-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "t"); git("config", "user.email", "t@t"); git("config", "core.hooksPath", "/dev/null");
  const write = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  const read = (p) => readFileSync(join(dir, p), "utf8");
  const r = { dir, git, write, read };
  setup(r);
  return r;
}

/** The focused terminal is in `dir` (space s1 on this computer, or on `machine`: the stubs run its
 *  commands here all the same). */
export function at(dir, machine = null) {
  state.spaces = [{ id: "s1", active: true, folder: dir, machine }];
  state.panes = [{ pane: "p1", cwd: dir }];
  state.focused = { space: "s1", tab: "t1", pane: "p1", terminal: machine ? `${machine}/t1` : "t1", cwd: dir };
}

/** A copy of the mod with `props`, its init run with an AsyncContext, everything it started settled. */
export async function mount(dir, props = {}, machine = null) {
  state.props = props; state.violations.length = 0; state.overlays.length = 0; state.runs.length = 0; state.notes.length = 0; state.commands.length = 0;
  if (dir !== undefined) at(dir, machine);
  const view = new View();
  // The page is a copy of its own (stubs.mjs inCall: what its calls start is its).
  view.copy = { name: "the page", closed: false };
  stubs.inCall(view.copy, () => view.init({}, makeCx("async")));
  await settle();
  return view;
}
/** A copy for an overlay's props (a question, a commit menu…), as Herdr opens it. */
export function overlay(spec, id = "ov1") {
  const saved = state.props, copy = stubs.overlayCopy(spec), oid = copy?.id ?? id;
  state.props = { ...spec.props, overlay: oid };
  const view = new View();
  // The overlay's copy (openOverlay made it): closeOverlay closes it, and what it started then.
  view.copy = copy ?? { name: `overlay ${oid}`, id: oid, closed: false };
  stubs.inCall(view.copy, () => view.init({}, makeCx("async")));
  state.props = saved;
  return { view, props: { ...spec.props, overlay: oid } };
}
/** Runs `fn` as a call of the overlay `spec` and closes it after, as its own click does (a question's
 *  row: the answer, then closeOverlay). */
export function asOverlay(spec, fn) {
  const copy = stubs.overlayCopy(spec);
  return stubs.inCall(copy, () => { const r = fn(); if (copy) stubs.closeOverlay(copy.id); return r; });
}
/** Renders an overlay copy with its own props in place. */
export function drawWith(view, props) {
  const saved = state.props;
  state.props = props;
  try { return renderNow(view); } finally { state.props = saved; }
}

// A render with Herdr's render-phase rules: cx.notify() and setShared() throw. Its tree is checked
// for layouts that fail on screen (layoutlint.mjs); what it finds goes into state.violations.
export function renderNow(view) {
  state.rendering = true; state.drawing = view.copy ?? null;
  let tree;
  try { tree = stubs.inCall(view.copy ?? null, () => view.render(makeCx())); } finally { state.rendering = false; state.drawing = null; }
  state.violations.push(...layoutProblems(tree));
  return tree;
}
export async function draw(view) { const tree = renderNow(view); await settle(); return tree; }
