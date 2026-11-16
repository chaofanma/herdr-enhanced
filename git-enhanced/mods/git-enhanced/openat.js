// Right-click on a diff line: a menu with "Ask about line N…" (as before: the line goes to the
// agent) and "Open at line N" with the program the settings name for lines (herdr-enhanced.open-with's
// `line`: "system" or one of its items; openwith.js). In a space on another machine, its terminal
// editors run there and the editors that open files over ssh (Zed, VS Code, Cursor, or a program
// of your own with a command for that) run here with the machine's ssh target (openwith.js
// remoteCommand, shared); the system's opener can't reach that file. No Herdr imports (exec, run and the ssh target come in): tested with node
// (test/git-enhanced/openat.test.mjs).
import { itemsOf, commandFor, detectScript, foundOf, remoteCommand } from "./openwith.js";

/** What "Open at line N" runs for file `path` (absolute) at `line`: `{ kind, argv, folder?, name }`.
 *  `kind`: "app" (run it and leave), "pane" (in a terminal right of the focused pane) or "system"
 *  (the platform's opener: it opens the file, not the line). `openWith`: the settings group;
 *  `found`: what openwith.js detectScript found; `platform`: "macos", "linux" or "windows". An
 *  item that isn't on this computer falls back to the system's, saying which (`missing`). */
export function openAt({ openWith, found, path, line, platform }) {
  const id = openWith?.line ?? "system";
  if (id !== "system") {
    const item = itemsOf(openWith.items).find((i) => i.id === id && i.enabled);
    const c = item && found ? commandFor(item, found, { path, dir: false, line }) : null;
    if (c) return { ...c, name: item.name };
    return { ...systemOpen(path, platform), missing: item?.name ?? id };
  }
  return systemOpen(path, platform);
}

const systemOpen = (path, platform) => ({ kind: "system", name: "the default app", argv: platform === "windows" ? ["explorer", path] : [platform === "macos" ? "open" : "xdg-open", path] });
/** The command that opens web page `url` in the browser here. */
export const urlCommand = (url, platform) => (platform === "windows" ? ["rundll32", "url.dll,FileProtocolHandler", url] : [platform === "macos" ? "open" : "xdg-open", url]);

/** What "Open at line N" runs for file `path` (absolute, on machine `on`) in a space there:
 *  openwith.js remoteCommand for the settings' item for lines, `{ kind, argv, folder, name }`, or
 *  `{ kind: "none", why }` when nothing here can open it. `found`: { here, there }, what
 *  detectScript found on this computer and on that machine; `host`: its ssh target (machine.js
 *  hostOf; null when it has none). */
export function remotePlan({ openWith, found, path, line, on, host }) {
  const id = openWith?.line ?? "system";
  if (id === "system") return { kind: "none", why: `The default app is on this computer; Open with can name an editor that reaches ${on}` };
  const item = itemsOf(openWith.items).find((i) => i.id === id && i.enabled);
  const c = item && found ? remoteCommand(item, found, { path, dir: false, line }, host) : null;
  if (!c) return { kind: "none", why: `${item?.name ?? id} can't open files on ${on}${item && !host ? " (no ssh target for it)" : ""}` };
  return { ...c, name: item.name };
}

/** The menu of a diff row of kind `kind` ("@", "+", "-", " ") opening at `line`: Ask, and Open
 *  (off for a file that is gone, and where nothing can open it). `plan`: openAt's or remotePlan's;
 *  `machine`: the space's machine (null here). */
export function lineMenu({ kind, line, local = true, exists, plan, machine = null }) {
  const ask = kind === "@" ? "Ask about this hunk…" : kind === "-" ? "Ask about this removed line…" : `Ask about line ${line}…`;
  const why = !exists ? "The file is deleted" : !plan ? (local ? null : "Only for this computer's repositories") : plan.kind === "none" ? plan.why : null;
  const how = !plan || plan.kind === "none" ? null : plan.kind === "system" ? `${plan.missing ? `${plan.missing} isn't here: ` : ""}the default app opens the file, not the line`
    : `in ${plan.name}${machine ? (plan.kind === "pane" ? ` on ${machine}` : ` (over ssh)`) : ""}`;
  return [
    { id: "ask", label: ask, detail: "Sends it to the space's agent" },
    { id: "open", label: `Open at line ${line}`, detail: why ?? how ?? undefined, disabled: Boolean(why) },
  ];
}

/** Runs `plan` (openAt's) with Herdr's `exec` and `run`: an app or the system's opener as a
 *  program, a pane item in a terminal right of the focused pane. Resolves with what went wrong, or null. */
export async function runPlan(plan, { exec, run }) {
  if (plan.kind === "pane") { run("terminal.open", { argv: plan.argv, folder: plan.folder, place: "right" }); return null; }
  const r = await exec(plan.argv[0], plan.argv.slice(1), plan.folder ? { cwd: plan.folder } : {}).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
  return r.code === 0 ? null : (r.stderr || r.stdout || "").trim().split("\n")[0] || `${plan.argv[0]} failed`;
}

/** What openwith.js finds on this computer, or on machine `on` (its detectScript, run with `exec`),
 *  looked for again after `ttl` ms: `await programs(items, on)` gives foundOf's sets. */
export function programFinder(exec, ttl = 300000) {
  const last = new Map();
  return async (items, on = null) => {
    const k = on ?? "", was = last.get(k);
    if (was && Date.now() - was.at < ttl) return was.found;
    const r = await exec("sh", ["-c", detectScript(items)], { on }).catch(() => null);
    const found = foundOf(r?.stdout ?? "");
    last.set(k, { at: Date.now(), found });
    return found;
  };
}
