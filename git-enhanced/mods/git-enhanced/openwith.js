// "Open with": the programs the panel's menus offer for a file or folder, and the command each runs.
// An app item runs its command and leaves (exec); a pane item runs in a terminal right of the focused
// pane (terminal.open), in the target's folder. Placeholders in a command: {path} (the file or
// folder), {file} (the file; for a folder, the folder), {folder} (the folder, or the file's folder),
// {line} (a line number, 1 when none is known). An item shows only where its program is found
// (DETECT), and only for what it is `for`: files, folders or both. Pure, so it can be tested; mods
// copy this file unchanged (see panelsettings.js).
//
// In a space on another machine (remoteMenuItems, remoteCommand): a pane item runs there, in a
// terminal of that space, when the same detection run on that machine finds it. An app item runs
// here, so it can take a file there only with a `remote` form: { argv, argvLine?, port? } that opens
// it over ssh, with {host} (the machine's ssh target, `hc machine ls`: hostIn) besides the usual
// placeholders; `port: false` for a form that can't take a target with a port (VS Code's
// ssh-remote+ authority). Zed, VS Code and Cursor have one; a program of the person's own may (the
// settings window's form). An app without one is left out there.

// Programs the settings window offers. `cli` is the command looked for; an app item whose cli is
// missing but whose `app` bundle is in /Applications or ~/Applications opens with `open -a`.
// `argvLine` opens at {line}; without it a line is ignored.
export const KNOWN = [
  { id: "zed", name: "Zed", kind: "app", for: "both", cli: "zed", app: "Zed", argv: ["zed", "{path}"], argvLine: ["zed", "{file}:{line}"],
    remote: { argv: ["zed", "ssh://{host}{path}"] } },
  { id: "vscode", name: "VS Code", kind: "app", for: "both", cli: "code", app: "Visual Studio Code", argv: ["code", "{path}"], argvLine: ["code", "-g", "{file}:{line}"],
    remote: { argv: ["code", "--remote", "ssh-remote+{host}", "{path}"], argvLine: ["code", "--remote", "ssh-remote+{host}", "-g", "{file}:{line}"], port: false } },
  { id: "cursor", name: "Cursor", kind: "app", for: "both", cli: "cursor", app: "Cursor", argv: ["cursor", "{path}"], argvLine: ["cursor", "-g", "{file}:{line}"],
    remote: { argv: ["cursor", "--remote", "ssh-remote+{host}", "{path}"], argvLine: ["cursor", "--remote", "ssh-remote+{host}", "-g", "{file}:{line}"], port: false } },
  { id: "sublime", name: "Sublime Text", kind: "app", for: "both", cli: "subl", app: "Sublime Text", argv: ["subl", "{path}"], argvLine: ["subl", "{file}:{line}"] },
  { id: "idea", name: "IntelliJ IDEA", kind: "app", for: "both", cli: "idea", app: "IntelliJ IDEA", argv: ["idea", "{path}"], argvLine: ["idea", "--line", "{line}", "{file}"] },
  { id: "pycharm", name: "PyCharm", kind: "app", for: "both", cli: "pycharm", app: "PyCharm", argv: ["pycharm", "{path}"], argvLine: ["pycharm", "--line", "{line}", "{file}"] },
  { id: "webstorm", name: "WebStorm", kind: "app", for: "both", cli: "webstorm", app: "WebStorm", argv: ["webstorm", "{path}"], argvLine: ["webstorm", "--line", "{line}", "{file}"] },
  { id: "xcode", name: "Xcode", kind: "app", for: "both", cli: "xed", app: "Xcode", argv: ["xed", "{path}"], argvLine: ["xed", "-l", "{line}", "{file}"] },
  { id: "typora", name: "Typora", kind: "app", for: "files", cli: "", app: "Typora", argv: ["open", "-a", "Typora", "{file}"] },
  { id: "nvim", name: "Neovim", kind: "pane", for: "files", cli: "nvim", argv: ["nvim", "{file}"], argvLine: ["nvim", "+{line}", "{file}"] },
  { id: "vim", name: "Vim", kind: "pane", for: "files", cli: "vim", argv: ["vim", "{file}"], argvLine: ["vim", "+{line}", "{file}"] },
  { id: "helix", name: "Helix", kind: "pane", for: "files", cli: "hx", argv: ["hx", "{file}"], argvLine: ["hx", "{file}:{line}"] },
  { id: "micro", name: "micro", kind: "pane", for: "files", cli: "micro", argv: ["micro", "{file}"], argvLine: ["micro", "+{line}", "{file}"] },
  { id: "emacs", name: "Emacs", kind: "pane", for: "files", cli: "emacs", argv: ["emacs", "-nw", "{file}"], argvLine: ["emacs", "-nw", "+{line}", "{file}"] },
  { id: "nano", name: "nano", kind: "pane", for: "files", cli: "nano", argv: ["nano", "{file}"], argvLine: ["nano", "+{line}", "{file}"] },
  { id: "yazi", name: "yazi", kind: "pane", for: "folders", cli: "yazi", argv: ["yazi"] },
  { id: "ranger", name: "ranger", kind: "pane", for: "folders", cli: "ranger", argv: ["ranger"] },
  { id: "lf", name: "lf", kind: "pane", for: "folders", cli: "lf", argv: ["lf"] },
  { id: "nnn", name: "nnn", kind: "pane", for: "folders", cli: "nnn", argv: ["nnn"] },
  { id: "broot", name: "broot", kind: "pane", for: "folders", cli: "broot", argv: ["broot"] },
  { id: "lazygit", name: "lazygit", kind: "pane", for: "folders", cli: "lazygit", argv: ["lazygit"] },
  { id: "gitui", name: "gitui", kind: "pane", for: "folders", cli: "gitui", argv: ["gitui"] },
  { id: "tig", name: "tig", kind: "pane", for: "folders", cli: "tig", argv: ["tig"] },
];

// The menu before there were settings: Zed, Neovim for files, yazi and lazygit for folders.
const STARTERS = ["zed", "nvim", "yazi", "lazygit"];
export const DEFAULT_ITEMS = STARTERS.map(id => ({ ...KNOWN.find(k => k.id === id), enabled: true }));

const KINDS = ["app", "pane"], FOR = ["files", "folders", "both"];
const strings = v => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === "string");

// A stored item's remote form, checked: { argv, argvLine?, port? } (copies), or null (none, or one that
// can't be used: it is dropped, the item kept).
export function remoteOf(v) {
  if (!v || typeof v !== "object" || Array.isArray(v) || !strings(v.argv) || !v.argv[0].trim()) return null;
  if (v.argvLine !== undefined && !strings(v.argvLine)) return null;
  if (v.port !== undefined && typeof v.port !== "boolean") return null;
  const out = { argv: [...v.argv] };
  if (v.argvLine) out.argvLine = [...v.argvLine];
  if (v.port !== undefined) out.port = v.port;
  return out;
}

// One stored item, checked; null when it can't be used.
export function itemOf(v) {
  if (!v || typeof v !== "object") return null;
  if (typeof v.id !== "string" || !/^[a-z0-9-]+$/.test(v.id) || typeof v.name !== "string" || !v.name.trim()) return null;
  if (!KINDS.includes(v.kind) || !FOR.includes(v.for) || !strings(v.argv)) return null;
  if (v.argvLine !== undefined && !strings(v.argvLine)) return null;
  const out = { id: v.id, name: v.name.trim(), kind: v.kind, for: v.for, argv: [...v.argv], enabled: v.enabled !== false };
  if (v.argvLine) out.argvLine = [...v.argvLine];
  if (typeof v.cli === "string") out.cli = v.cli;
  if (typeof v.app === "string" && v.app) out.app = v.app;
  const remote = v.kind === "app" ? remoteOf(v.remote) : null;
  if (remote) out.remote = remote;
  return out;
}

// The person's list (KEYS.openWith's items, panelsettings.js), or the default one; unusable items
// and repeated ids are dropped.
export function itemsOf(stored) {
  if (!Array.isArray(stored)) return DEFAULT_ITEMS.map(i => ({ ...i }));
  const seen = new Set(), out = [];
  for (const v of stored) { const i = itemOf(v); if (i && !seen.has(i.id)) { seen.add(i.id); out.push(i); } }
  return out;
}

// The command an item is looked for by: its cli, else (an item the person added) the program it runs.
export const cliOf = item => (item.cli !== undefined ? item.cli : item.argv[0]);

// A shell script that prints `cli <name>` for each command found and `app <name>` for each app
// bundle found, for the known programs and the given items.
// The program of an item's remote form is looked for too (it runs here).
export function detectScript(items = []) {
  const all = [...KNOWN, ...items], remotes = all.map(i => i.remote?.argv?.[0]);
  const clis = [...new Set([...all.map(cliOf), ...remotes].filter(c => c && /^[A-Za-z0-9._+-]+$/.test(c)))];
  const apps = [...new Set(all.map(i => i.app).filter(a => a && !/["$`\\]/.test(a)))];
  return `for c in ${clis.join(" ")}; do command -v "$c" >/dev/null 2>&1 && echo "cli $c"; done; `
    + `for a in ${apps.map(a => `"${a}"`).join(" ")}; do for d in /Applications "$HOME/Applications"; do [ -d "$d/$a.app" ] && { echo "app $a"; break; }; done; done; true`;
}

// What detectScript printed, as sets.
export function foundOf(stdout) {
  const cli = new Set(), app = new Set();
  for (const line of String(stdout ?? "").split("\n")) {
    if (line.startsWith("cli ")) cli.add(line.slice(4).trim());
    else if (line.startsWith("app ")) app.add(line.slice(4).trim());
  }
  return { cli, app };
}

// How an item can run here: "cli", "app" (open -a), or null (not on this machine).
export function availability(item, found) {
  const c = cliOf(item);
  if (c && found.cli.has(c)) return "cli";
  if (item.kind === "app" && item.app && found.app.has(item.app)) return "app";
  if (c === "" && !item.app) return "cli";
  return null;
}

export const fits = (item, dir) => item.for === "both" || item.for === (dir ? "folders" : "files");

// A menu label: "Open yazi here" for a folder program in a pane, else "Open in <name>".
export const labelOf = (item, dir) => (dir && item.kind === "pane" && item.for === "folders" ? `Open ${item.name} here` : `Open in ${item.name}`);

// The items a menu shows for a file (dir false) or folder (dir true): enabled, found, fitting; in order.
export function menuItems(items, found, dir) {
  return items.filter(i => i.enabled && fits(i, dir) && availability(i, found)).map(i => ({ item: i, label: labelOf(i, dir) }));
}

const dirname = p => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) || "/" : ".");

// A command's argv with its placeholders filled in for a target { path, dir, line? }.
export function expand(argv, target) {
  const folder = target.dir ? target.path : dirname(target.path);
  const line = String(Number.isInteger(target.line) && target.line > 0 ? target.line : 1);
  const map = { "{path}": target.path, "{file}": target.path, "{folder}": folder, "{line}": line };
  return argv.map(a => a.replace(/\{(path|file|folder|line)\}/g, m => map[m]));
}

// What to run for an item and a target: { kind: "app" | "pane", argv, folder }, or null when the
// item can't run here. A line uses argvLine when there is one; an app found only as a bundle opens
// with `open -a` (no line).
export function commandFor(item, found, target) {
  const how = availability(item, found);
  if (!how) return null;
  const folder = target.dir ? target.path : dirname(target.path);
  if (how === "app" && cliOf(item) && !found.cli.has(cliOf(item))) {
    return { kind: "app", argv: ["open", "-a", item.app, target.path], folder };
  }
  const argv = target.line && item.argvLine ? item.argvLine : item.argv;
  return { kind: item.kind, argv: expand(argv, target), folder };
}

// Another machine ------------------------------------------------------------

const KNOWN_REMOTE = new Map(KNOWN.filter(k => k.remote).map(k => [k.id, k.remote]));
// An item's form for a file on another machine: its own `remote`, else (a stored copy of a known
// program from before they had one) the known program's; null when it has none.
export const remoteForm = item => (item.remote && strings(item.remote.argv) ? item.remote : KNOWN_REMOTE.get(item.id) ?? null);

// "user@host:2222" has a port; "vps", "user@host" don't.
export const hasPort = target => /:\d+$/.test(target ?? "");

// The ssh target Herdr reaches a machine by: `hc machine ls`'s target (`machines`, its JSON's list),
// unless it's reached through a command (via) rather than ssh, or isn't known; then null.
export function hostIn(machines, on) {
  const m = (machines ?? []).find(x => x?.name === on);
  return m && !m.via && typeof m.target === "string" && m.target ? m.target : null;
}

// found: { here, there }: what detectScript found on this computer and on the space's machine. A
// remote form's program runs here: found here, or given by its path (not looked for).
const usable = (item, found, host) => {
  if (item.kind === "pane") return Boolean(availability(item, found.there));
  const form = remoteForm(item);
  return Boolean(form && host && !(form.port === false && hasPort(host)) && (form.argv[0].includes("/") || found.here?.cli.has(form.argv[0])));
};

// The items a menu shows for a file (dir false) or folder there: enabled, fitting, usable; in order.
export const remoteMenuItems = (items, found, dir, host) =>
  items.filter(i => i.enabled && fits(i, dir) && found && usable(i, found, host)).map(i => ({ item: i, label: labelOf(i, dir) }));

// What to run for an item and a target { path, dir, line? } there (host: the machine's ssh target, or
// null): a pane item's command (run in a terminal of that space), or an app's remote form (run here,
// with no folder of its own: the target's folder isn't on this computer); null when the item can't.
export function remoteCommand(item, found, target, host) {
  if (!found || !usable(item, found, host)) return null;
  if (item.kind === "pane") return commandFor(item, found.there, target);
  const form = remoteForm(item), argv = target.line && form.argvLine ? form.argvLine : form.argv;
  return { kind: "app", argv: expand(argv.map(a => a.split("{host}").join(host)), target), folder: null };
}
