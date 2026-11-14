// Stub gpui-kit / gpui-base / herdr for render tests of the mod, with the Herdr rules these tests
// need: cx.notify() and setShared() throw while a view renders, and cx.spawn runs its body at once
// (Herdr calls body(cx) and adopts the promise), so code before its first await runs in the caller's
// phase. exec runs the program here whatever its `on`: a space "on another machine" in a test runs the
// mod's remote code paths (sh scripts, base64 saves, polling) against local folders. state.sh picks
// the shell sh means (dash: a Linux machine's), state.path its PATH (shims for GNU tools).
import "../../shared/no-outer-git.mjs";
import { execFile } from "node:child_process";
import { readFile as readFileP } from "node:fs/promises";
import { tempDir } from "../tmp.mjs";

export const state = {
  inRenderer: false, violations: [], props: {}, shared: new Map(), overlays: [], closed: [], runs: [], notes: [], focused: null, spaces: [], panes: [],
  agents: [], tasks: [], execLog: [], execHook: null, hcLog: [], hcHook: null, focusCalls: 0, inflight: 0, rendering: false, notified: 0,
  sh: null, path: null, machines: [], layout: null, watched: [], writes: [], platform: "macos", everies: [], palette: null, dark: true,
};

const HANDLER = /^on_/;
// An element: `el.$` is what it recorded (kind, id, children, handlers, calls, extras).
function el(kind, extra = {}) {
  const data = { kind, calls: [], children: [], handlers: {}, id: null, ...extra };
  const proxy = new Proxy(data, {
    get(target, prop) {
      if (prop === "$") return target;
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return (...args) => {
        // A child is consumed; using it again throws in the real kit.
        const consume = (c) => { if (c?.$) { if (c.$.consumed) state.violations.push(`element used twice (${c.$.id ?? c.$.kind})`); c.$.consumed = true; } };
        if (prop === "when") return args[0] ? args[1](proxy) : proxy;
        if (prop === "child") { consume(args[0]); target.children.push(args[0]); return proxy; }
        if (prop === "children") { args[0].forEach(consume); target.children.push(...args[0]); return proxy; }
        if (prop === "trigger" || prop === "content") { consume(args[0]); target[prop + "El"] = args[0]; target.children.push(args[0]); return proxy; }
        if (prop === "id") target.id = args[0];
        if (prop === "hover") { args[0](el("style")); }
        if (HANDLER.test(prop) || prop === "tooltip") {
          if (state.inRenderer) state.violations.push(`${prop} inside a list renderer (${target.id ?? kind})`);
          (target.handlers[prop] ??= []).push(args);
        }
        // Herdr refuses a font family that isn't a non-empty string ("expected a string, got nil"),
        // and then the whole view stops drawing.
        if (prop === "font_family" && (typeof args[0] !== "string" || args[0] === "")) state.violations.push(`font_family(${JSON.stringify(args[0])}) on ${target.id ?? kind}: Herdr wants a string`);
        target.calls.push([prop, args]);
        return proxy;
      };
    },
  });
  return proxy;
}

// gpui-kit
export class View {}
export const div = () => el("div");
export const svg = (path) => el("svg", { path });
export const image = (path) => el("image", { path });

// gpui-base
export const v_flex = () => el("v_flex");
export const h_flex = () => el("h_flex");
function textState(kind) {
  return {
    new: (opts = {}) => {
      const s = { kind, opts, val: opts.value ?? "", handlers: {}, focused: 0 };
      s.value = () => s.val;
      s.set_value = (v) => { s.val = v; for (const h of s.handlers.change ?? []) h({}, makeCx()); };
      s.on = (ev, fn) => { (s.handlers[ev] ??= []).push(fn); return true; };
      s.focus = () => { s.focused++; };
      s.set_auto_grow = () => {}; s.set_rows = () => {};
      return s;
    },
  };
}
export const InputState = textState("input");
export const TextareaState = textState("textarea");
export const Input = { new: (s) => el("input", { state: s }) };
export const Textarea = { new: (s) => el("textarea", { state: s }) };
export const Scrollbar = { vertical: (id) => el("scrollbar", { for: id }) };
export const VirtualListScrollHandle = { new: () => ({ scrolled: [], scroll_to_item(i, how) { this.scrolled.push([i, how]); }, scroll_to_bottom() {}, release() { return true; } }) };
export const Popover = { new: (id) => el("popover", { popover: id }) };
export function v_virtual_list(id, count, sizes, getKey, render) {
  if (Array.isArray(sizes) && sizes.length !== count) state.violations.push(`list ${id}: ${sizes.length} sizes for ${count} items`);
  return el("vlist", { listId: id, count, sizes, getKey, render });
}

// cx
export function makeCx() {
  const cx = {
    notify() {
      if (state.rendering) throw new Error("cx.notify() is not allowed during the `render` phase; request a re-render from an event handler instead");
      state.notified++;
    },
    stop_propagation() { cx.stopped = true; }, write_to_clipboard() {},
    spawn(fn) { const p = Promise.resolve(fn(makeCx())).catch((e) => { state.violations.push(`task threw: ${e.stack ?? e}`); }); state.tasks.push(p); return { cancel() {} }; },
    sleep(ms = 0) { state.inflight++; return new Promise((r) => setTimeout(() => { state.inflight--; r(); }, ms)); },
    timer: {
      // Kept, not run: a test runs one with state.everies.at(-1).fn(makeCx()).
      every(ms, fn) { state.everies.push({ ms, fn }); return { cancel() {} }; },
      // Pending timers count as work in flight, so settle() waits for them.
      after(ms, fn) {
        let pending = true; state.inflight++;
        const t = setTimeout(() => { pending = false; state.inflight--; try { fn(makeCx()); } catch (e) { state.violations.push(`timer threw: ${e.stack ?? e}`); } }, ms);
        state.tasks.push(Promise.resolve());
        return { cancel() { if (pending) { pending = false; clearTimeout(t); state.inflight--; } } };
      },
    },
    focus_handle() { const h = { focus() { state.focusCalls++; state.focusedHandle = h; }, is_focused() { return state.focusedHandle === h; }, release() { return true; } }; return h; },
  };
  return cx;
}
export async function settle() {
  // Until no git is running and no task started for a few ticks (some tasks wait forever: commands, watchers).
  let quiet = 0, seen = state.tasks.length;
  for (let k = 0; k < 400 && quiet < 4; k++) {
    await new Promise((r) => setTimeout(r, 10));
    if (state.inflight === 0 && state.tasks.length === seen) quiet++; else { quiet = 0; seen = state.tasks.length; }
  }
}

// herdr
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PI_")));
// Programs that would show something on the screen (open an app, a file, Finder, the Trash) or ask an
// AI provider (an agent's CLI): never run by a test, which gets "it worked" unless its execHook says
// otherwise; nor a script handed one to run (`sh -c script sh <program> …`: the probes that only look
// programs up name them later), nor perl naming one. DETACH (an Open with app item) is told apart by
// its temp file's name.
const SCREEN = new Set(["open", "xdg-open", "osascript", "zed", "code", "cursor", "subl", "xed", "explorer", "rundll32", "gio", "trash", "/usr/bin/trash", "trash-put"]);
const AGENTS = new Set(["pi", "claude", "codex", "opencode"]);
const starter = a => SCREEN.has(a) || AGENTS.has(a);
const starts = (command, args) => starter(command) || (command === "perl" && args.some(starter))
  || (command === "sh" && (starter(args[3]) || /-open\.XXXXXX/.test(args[1] ?? "")));
export function exec(command, args = [], { cwd, on } = {}) {
  state.execLog.push([command, args, cwd, on]);
  if (state.execHook) { const r = state.execHook(command, args, cwd, on); if (r) return Promise.resolve(r); }
  if (starts(command, args)) return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  state.inflight++;
  const program = command === "sh" && state.sh ? state.sh : command, e = state.path ? { ...env, PATH: state.path } : env;
  return new Promise((resolve, reject) => {
    execFile(program, args, { cwd, env: e, maxBuffer: 8 << 20, encoding: "utf8" }, (err, stdout, stderr) => {
      state.inflight--;
      if (err && typeof err.code === "string") return reject(err);
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}
// hc: `machine ls` answers state.machines; anything else is recorded and answered by state.hcHook, else "worked".
export const hc = async (args) => {
  if (args[0] === "machine" && args[1] === "ls") return { code: 0, stdout: JSON.stringify({ machines: state.machines }), stderr: "" };
  state.hcLog.push(args);
  return state.hcHook?.(args) ?? { code: 0, stdout: "", stderr: "" };
};
export const readTextFile = async (path) => { state.inflight++; try { return await readFileP(path, "utf8"); } catch { return null; } finally { state.inflight--; } };
export const watchFolder = (path) => { state.watched.push(path); return new Promise(() => {}); };
export const nextCommand = () => new Promise(() => {});
export const theme = () => state.palette ?? new Proxy({}, { get: (_t, k) => (typeof k === "string" ? "#123456" : undefined) });
export const settings = () => ({ font_size: 14 });
export const props = () => state.props;
export const shared = (k) => state.shared.get(k);
export const setShared = (k, v) => {
  if (state.rendering) throw new Error("setShared() during render");
  state.shared.set(k, v); return null;
};
export const openOverlay = (spec) => { state.overlays.push(spec); return `o${state.overlays.length}`; };
export const closeOverlay = (id) => { state.closed.push(id); return null; };
export const notify = (n) => { state.notes.push(n); return "n"; };
export const run = (name, args) => { state.runs.push([name, args]); return null; };
export const spaces = () => state.spaces;
export const panes = () => state.panes;
export const focused = () => state.focused;
export const agents = () => state.agents;
export const layout = () => state.layout;
export const home = () => process.env.HOME;

// For the files mod.
export const Editor = { new: (s) => el("editor", { state: s }) };
export const EditorState = { new: (opts = {}) => { const s = { opts, val: opts.value ?? "", handlers: {} }; s.value = () => s.val; s.set_value = (v) => { s.val = v; }; s.on = (ev, fn) => { (s.handlers[ev] ??= []).push(fn); return true; }; s.release = () => true; return s; } };
export const TextView = { new: (...a) => el("textview", { args: a }) };
export const writeTextFile = async () => null;
export const window = () => ({ platform: state.platform });
// The app's folder: empty, so the other panel mod isn't installed unless a test puts its main.js there.
export const APP_HOME = tempDir("files-enhanced-apphome-");
export const appHome = () => state.appHome ?? APP_HOME;
