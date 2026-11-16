// Stub gpui-kit / gpui-base / herdr for the mod's render tests, with the Herdr rules that matter:
// cx.notify() and setShared() throw while a view renders (state.rendering, set by draw() and
// renderRows()); a call's cx (a handler's, a render's) is good only while that call runs, while the cx
// init, cx.spawn and cx.timer hand out may be kept across awaits; cx.spawn runs its body at once (code
// before its first await runs in the caller's phase); pending timers and sleeps count in settle(). A
// text state's set_value delivers "change" at once, except during a render, where it waits until the
// render is over (GPUI delivers events as effects). exec runs git for real (whatever its `on`: a space
// "on another machine" runs the remote code paths against local folders), sh scripts too, and find;
// anything else (an app, an editor, the system's opener, an AI agent, `hc`) is never started: the
// test's execHook answers it, else it is answered "worked" and recorded as a violation. state.sh picks
// the shell sh means (dash: a Linux machine's). What exec runs gets a HOME of its own in the temp folder
// (state.home), so no script can write into the person's home (a worktree goes to
// $HOME/.herdr/worktrees); git there reads no global config.
// Calls: Herdr runs a mod's code in calls (a click, a timer, an exec's result, a render), each a
// copy's (the page, a menu, a dialog). What a call starts (an exec, a timer) is that copy's, and once
// the copy closes it never comes back: a promise one copy's call settles goes on in that call (a
// question's answer, in the question's click). Here state.call is the copy whose call runs (null: the
// test's own code); a handler runs in the call of the copy that drew it, an exec's result or a timer
// in its starter's; one started in a copy that closed is a violation and never settles. A repeating
// timer under 1 s (a page waiting for an answer) ticks after each call.
import "../../shared/no-outer-git.mjs";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tempDir } from "../tmp.mjs";

export const state = {
  inRenderer: false, violations: [], props: {}, shared: new Map(), overlays: [], closed: [], runs: [], notes: [], focused: null, spaces: [], panes: [],
  agents: [], tasks: [], execLog: [], execHook: null, hcLog: [], hcHook: null, focusCalls: 0, inflight: 0, rendering: false, notified: 0, everies: [],
  sh: null, machines: [], layout: null, watched: [], clipboard: [], commands: [], dark: true, palette: null,
  home: tempDir("git-enhanced-home-"),
  call: null, drawing: null, polls: [],
};

/** Runs `fn` as a call of `copy` ({ name, closed }, or null: no copy's): what it starts is that copy's,
 *  and the promises it settles go on in it (until the call is over: its microtasks run). */
export function inCall(copy, fn) {
  state.call = copy ?? null;
  try { return fn(); }
  finally {
    setImmediate(() => {
      if (state.call === copy) state.call = null;
      // A page's poll ticks after another call (the click that answered it), each in a call of its own.
      for (const p of state.polls) if (!p.done && !p.owner?.closed) setImmediate(() => tick(p));
    });
  }
}
function tick(p) {
  if (p.done || p.owner?.closed) return;
  state.call = p.owner;
  try { p.fn(makeCx("async")); } catch (e) { state.violations.push(`timer threw: ${e.stack ?? e}`); }
  setImmediate(() => { if (state.call === p.owner) state.call = null; });
}
// What a closed copy started: in Herdr its result never comes back.
const lost = (owner, what) => state.violations.push(`${what} was started in ${owner.name}'s call, which closed: it never comes back`);

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
        // A resizable_panel belongs to its group: added anywhere else, the real kit throws.
        const loose = (c) => c?.$?.kind === "resizable_panel" && target.kind !== "h_resizable" && target.kind !== "v_resizable";
        if ((prop === "child" && loose(args[0])) || (prop === "children" && args[0].some(loose))) state.violations.push(`a resizable_panel outside a resizable group (${target.id ?? kind})`);
        if (prop === "child") { consume(args[0]); target.children.push(args[0]); return proxy; }
        if (prop === "children") { args[0].forEach(consume); target.children.push(...args[0]); return proxy; }
        if (prop === "trigger" || prop === "content") { consume(args[0]); target[prop + "El"] = args[0]; target.children.push(args[0]); return proxy; }
        if (prop === "id") target.id = args[0];
        if (prop === "hover") { args[0](el("style")); }
        if (HANDLER.test(prop) || prop === "tooltip") {
          if (state.inRenderer) state.violations.push(`${prop} inside a list renderer (${target.id ?? kind})`);
          // A handler runs in a call of the copy that drew it.
          const owner = state.drawing, last = args.length - 1;
          if (HANDLER.test(prop) && typeof args[last] === "function") { const fn = args[last]; args = [...args.slice(0, last), (...a) => inCall(owner, () => fn(...a))]; }
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
      if (state.rendering) state.violations.push(`${kind} state made during a render`);
      const s = { kind, opts, val: opts.value ?? "", handlers: {}, focused: 0 };
      s.value = () => s.val;
      s.set_value = (v) => {
        const same = s.val === v;
        s.val = v;
        if (same) return;
        const deliver = () => { for (const h of s.handlers.change ?? []) h({}, makeCx()); };
        if (!state.rendering) { deliver(); return; }
        state.inflight++;
        setTimeout(() => { state.inflight--; try { deliver(); } catch (e) { state.violations.push(`change handler threw: ${e.stack ?? e}`); } }, 0);
      };
      s.on = (ev, fn) => { (s.handlers[ev] ??= []).push(fn); return true; };
      s.focus = () => { s.focused++; };
      s.set_auto_grow = () => {}; s.set_rows = () => {}; s.set_soft_wrap = () => {}; s.release = () => true;
      return s;
    },
  };
}
export const InputState = textState("input");
export const TextareaState = textState("textarea");
export const Input = { new: (s) => el("input", { state: s }) };
export const Textarea = { new: (s) => el("textarea", { state: s }) };
export const Scrollbar = { vertical: (id) => el("scrollbar", { for: id }) };
// gpui-base's ScrollHandle for a plain scroll area (the layout entry's tab bar keeps its active tab in view).
export const ScrollHandle = { new: () => ({ scrolled: [], scroll_to_item(i) { this.scrolled.push(i); } }) };
export const VirtualListScrollHandle = { new: () => ({ scrolled: [], scroll_to_item(i, how) { this.scrolled.push([i, how]); }, scroll_to_bottom() {}, release() { return true; } }) };
export const Popover = { new: (id) => el("popover", { popover: id }) };
// A row or column of panels with lines to drag between them (the sizes are the window's, by id).
export const h_resizable = (id) => el("h_resizable", { group: id });
export const v_resizable = (id) => el("v_resizable", { group: id });
export const resizable_panel = () => el("resizable_panel");
export function v_virtual_list(id, count, sizes, getKey, render) {
  if (Array.isArray(sizes) && sizes.length !== count) state.violations.push(`list ${id}: ${sizes.length} sizes for ${count} items`);
  return el("vlist", { listId: id, count, sizes, getKey, render });
}
// PathBuilder / Background and the ambient `window.paint_path` the graph draws with.
function pathBuilder(kind, width) {
  const ops = [];
  const b = new Proxy({}, { get(_t, prop) { if (prop === "build") return () => ({ kind, width, ops: [...ops] }); return (...args) => { ops.push([prop, ...args]); return b; }; } });
  return b;
}
export const PathBuilder = { fill: () => pathBuilder("fill"), stroke: (w) => pathBuilder("stroke", w) };
export const Background = { solid: (c) => ({ solid: c }) };
globalThis.window = { paint_path(path, bg) { if (!path || !Array.isArray(path.ops)) state.violations.push("paint_path without a built path"); return el("path", { path, bg }); } };

// cx. A call's cx (an event handler's, a render's) is good only while that call runs: here, until the
// current macrotask ends; using it later is a violation (Herdr throws: "never keep a cx").
export function makeCx(kind = "call") {
  let alive = true;
  if (kind === "call") setTimeout(() => { alive = false; }, 0);
  const check = (what) => { if (!alive) state.violations.push(`a call's cx was used after the call returned (${what})`); };
  const cx = {
    notify() {
      check("notify");
      if (state.rendering) throw new Error("cx.notify() is not allowed during the `render` phase; request a re-render from an event handler instead");
      state.notified++;
    },
    stop_propagation() { cx.stopped = true; },
    write_to_clipboard(text) { state.clipboard.push(text); },
    read_from_clipboard() { return state.clipboard.at(-1); },
    spawn(fn) { check("spawn"); const p = Promise.resolve(fn(makeCx("async"))).catch((e) => { state.violations.push(`task threw: ${e.stack ?? e}`); }); state.tasks.push(p); return { cancel() {}, is_done() { return false; } }; },
    sleep(ms = 0) {
      const owner = state.call;
      state.inflight++;
      return new Promise((r) => setTimeout(() => { state.inflight--; if (owner?.closed) lost(owner, "a sleep"); else inCall(owner, r); }, ms));
    },
    timer: {
      // The slow ones (the pages' refreshes and fetches) are only noted; a poll ticks after each call.
      every(ms, fn) {
        check("timer.every");
        if (ms >= 1000 || typeof fn !== "function") { state.everies.push(ms); return { cancel() {}, is_done() { return false; } }; }
        const p = { owner: state.call, fn, done: false };
        state.polls.push(p);
        return { cancel() { p.done = true; state.polls = state.polls.filter((x) => x !== p); }, is_done() { return p.done; } };
      },
      after(ms, fn) {
        check("timer.after");
        let pending = true; state.inflight++;
        const owner = state.call;
        const t = setTimeout(() => {
          pending = false; state.inflight--;
          if (owner?.closed) return;
          inCall(owner, () => { try { fn(makeCx("async")); } catch (e) { state.violations.push(`timer threw: ${e.stack ?? e}`); } });
        }, ms);
        state.tasks.push(Promise.resolve());
        return { cancel() { if (pending) { pending = false; clearTimeout(t); state.inflight--; } }, is_done() { return !pending; } };
      },
    },
    focus_handle() {
      if (state.rendering) state.violations.push("focus_handle made during a render");
      const h = { focus() { state.focusCalls++; state.focusedHandle = h; }, is_focused() { return state.focusedHandle === h; }, release() { return true; } };
      return h;
    },
  };
  return cx;
}
export async function settle() {
  // Until nothing runs and no task started for a few ticks (some tasks wait for ever: commands, watches).
  let quiet = 0, seen = state.tasks.length;
  for (let k = 0; k < 600 && quiet < 4; k++) {
    await new Promise((r) => setTimeout(r, 10));
    if (state.inflight === 0 && state.tasks.length === seen) quiet++; else { quiet = 0; seen = state.tasks.length; }
  }
}

// herdr
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PI_") && !k.startsWith("GIT_"))), HOME: state.home, XDG_CONFIG_HOME: `${state.home}/.config` };
// What a test may really run: git, find, and the mod's sh scripts, which run git (and look for
// programs with `command -v`). The one script that starts another program is the pen's (PEN_SH,
// told by its temp folder's name): it would run an AI agent. A script handed an editor, an opener or
// an agent's CLI to run (`sh -c script sh <program> …`; the probes that only look programs up name
// them later) is never run either.
const REAL = new Set(["git", "find"]);
const STARTS = new Set(["open", "xdg-open", "osascript", "zed", "code", "cursor", "subl", "xed", "explorer", "rundll32", "gio", "trash", "/usr/bin/trash", "trash-put", "pi", "claude", "codex", "opencode"]);
export function exec(command, args = [], { cwd, on } = {}) {
  state.execLog.push([command, args, cwd, on]);
  const owner = state.call, what = `exec ${command} ${args.filter((a) => typeof a === "string" && !a.includes("\n")).slice(0, 6).join(" ").slice(0, 90)}`;
  if (owner?.closed) { lost(owner, what); return new Promise(() => {}); }
  if (state.execHook) { const r = state.execHook(command, args, cwd, on); if (r) return Promise.resolve(r); }
  const startsSomething = command === "sh" && (/-pen\.XXXXXX/.test(String(args[1] ?? "")) || STARTS.has(args[3]));
  if ((command !== "sh" && !REAL.has(command)) || startsSomething) {
    state.violations.push(`a test would have started ${command === "sh" ? `sh ${args.slice(3).join(" ").slice(0, 80)}` : `${command} ${args.join(" ").slice(0, 80)}`}`);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  }
  state.inflight++;
  const program = command === "sh" && state.sh ? state.sh : command;
  return new Promise((resolve, reject) => {
    execFile(program, args, { cwd, env, maxBuffer: 8 << 20, encoding: "utf8" }, (err, stdout, stderr) => {
      state.inflight--;
      if (owner?.closed) { lost(owner, what); return; }
      inCall(owner, () => {
        if (err && typeof err.code === "string") return reject(err);
        resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
      });
    });
  });
}
export const hc = async (args) => {
  state.hcLog.push(args);
  if (state.hcHook) { const r = state.hcHook(args); if (r) return r; }
  if (args[0] === "machine" && args[1] === "ls") return { code: 0, stdout: JSON.stringify({ machines: state.machines }), stderr: "" };
  return { code: 0, stdout: "", stderr: "" };
};
// Herdr's readTextFile gives null past 1 MiB (as for a file it can't read). Counted as work in flight,
// so settle() waits for it.
export const readTextFile = async (path) => { state.inflight++; try { const t = await readFile(path, "utf8"); return Buffer.byteLength(t) > 1048576 ? null : t; } catch { return null; } finally { state.inflight--; } };
export const writeTextFile = async () => { state.violations.push("writeTextFile: this mod writes files through git and sh"); return null; };
export const watchFolder = (path) => { state.watched.push(path); return new Promise(() => {}); };
export const nextCommand = () => new Promise((resolve) => { state.commands.push(resolve); });
// state.palette: one of Herdr's themes (test/shared/themes.json); else every color is #123456.
export const theme = () => state.palette ?? new Proxy({}, { get: (_t, k) => (typeof k === "string" ? "#123456" : undefined) });
// What the app runs with (herdr.d.ts settings()): a test sets more fields in `state.settings`.
export const settings = () => ({ font_size: 14, dark: state.dark, ...(state.settings ?? {}) });
export const props = () => state.props;
export const shared = (k) => state.shared.get(k);
export const setShared = (k, v) => {
  if (state.rendering) throw new Error(`setShared("${k}") during the render phase`);
  state.shared.set(k, v); return null;
};
// An overlay is a copy of its own (overlayCopy(spec): { name, id, closed }), closed by closeOverlay;
// load.mjs overlay() draws it.
const COPIES = new WeakMap(), BY_ID = new Map();
export const overlayCopy = (spec) => COPIES.get(spec) ?? null;
export const openOverlay = (spec) => {
  state.overlays.push(spec);
  const id = `o${state.overlays.length}`, copy = { name: `${spec.kind ?? "overlay"} ${id}`, id, closed: false };
  COPIES.set(spec, copy); BY_ID.set(id, copy);
  return id;
};
export const closeOverlay = (id) => {
  state.closed.push(id);
  const copy = BY_ID.get(id);
  if (copy) copy.closed = true;
  return null;
};
export const notify = (n) => { state.notes.push(n); return "n"; };
export const run = (name, args) => { state.runs.push([name, args]); return null; };
export const spaces = () => state.spaces;
export const panes = () => state.panes;
export const focused = () => state.focused;
export const agents = () => state.agents;
export const layout = () => state.layout ?? null;
export const terminals = () => state.terminals ?? [];
export const machines = () => state.machines;
export const home = () => process.env.HOME;
export const APP_HOME = tempDir("git-enhanced-apphome-");
export const appHome = () => state.appHome ?? APP_HOME;
export const window = () => state.window ?? { platform: "macos" };
export const knownAgents = async () => [];
export const Editor = { new: (s) => el("editor", { state: s }) };
export const EditorState = { new: (opts = {}) => { const s = { opts, val: opts.value ?? "", handlers: {} }; s.value = () => s.val; s.set_value = (v) => { s.val = v; }; s.on = (ev, fn) => { (s.handlers[ev] ??= []).push(fn); return true; }; s.release = () => true; return s; } };
export const TextView = { new: (...a) => el("textview", { args: a }) };
