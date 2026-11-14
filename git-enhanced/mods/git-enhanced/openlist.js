// The settings window's "Open with" list: its groups and rows, and what each click does to the
// person's items (openwith.js). Ticking a known program adds a copy of it at the end of the list;
// unticking keeps it, switched off, so it keeps its place; the person's own programs are added,
// edited and removed. The list's order is the menus' order. Each function returns a new list and
// leaves the old one alone. Pure, so it can be tested.
import { KNOWN, DEFAULT_ITEMS, itemOf, cliOf, availability, fits, menuItems } from "./openwith.js";
import { KEYS, storedOf } from "./panelsettings.js";
import { splitCommand, joinCommand } from "./shellwords.js";

const KNOWN_BY_ID = new Map(KNOWN.map((k) => [k.id, k]));
export const isOwn = (item) => !KNOWN_BY_ID.has(item.id);

// The window's groups, in order. A known program belongs where KNOWN puts it, whatever a stored
// copy says; the person's own programs are all in "Your own".
export const GROUPS = [
  { id: "apps", title: "Apps" },
  { id: "files", title: "In a pane: files" },
  { id: "folders", title: "In a pane: folders" },
  { id: "own", title: "Your own" },
];

export function groupOf(item) {
  const known = KNOWN_BY_ID.get(item.id);
  if (!known) return "own";
  if (known.kind === "app") return "apps";
  return known.for === "folders" ? "folders" : "files";
}

// One group's rows, { item, ticked, first, last }: the ticked items first, in the list's (the
// menus') order, `first` / `last` among them; then the rest, known programs in KNOWN's order (so an
// unticked one doesn't move about), the person's own in the list's.
export function rowsOf(items, group) {
  const mine = items.filter((i) => groupOf(i) === group);
  const ticked = mine.filter((i) => i.enabled);
  const rest = group === "own"
    ? mine.filter((i) => !i.enabled)
    : KNOWN.filter((k) => groupOf(k) === group && !ticked.some((i) => i.id === k.id))
      .map((k) => mine.find((i) => i.id === k.id) ?? { ...k, enabled: false });
  return [
    ...ticked.map((item, n) => ({ item, ticked: true, first: n === 0, last: n === ticked.length - 1 })),
    ...rest.map((item) => ({ item, ticked: false, first: false, last: false })),
  ];
}

// Ticks an item: one already in the list is switched on where it is; a known program that isn't is
// added at the end, as a copy of its KNOWN entry (as DEFAULT_ITEMS makes them).
export function tick(items, id) {
  if (items.some((i) => i.id === id)) return items.map((i) => (i.id === id ? { ...i, enabled: true } : i));
  const known = KNOWN_BY_ID.get(id);
  return known ? [...items, { ...known, enabled: true }] : items;
}

// Unticks an item: it stays in the list, switched off, so ticking it again puts it back in its place.
export const untick = (items, id) => items.map((i) => (i.id === id ? { ...i, enabled: false } : i));

// Moves a ticked item one place up (by < 0) or down among its group's ticked items. It goes just
// before (or after) the one it passes, so everything else keeps its place in the menus.
export function move(items, id, by) {
  const at = items.findIndex((i) => i.id === id);
  if (at < 0 || !items[at].enabled) return items;
  const group = groupOf(items[at]);
  const peers = items.filter((i, n) => n !== at && i.enabled && groupOf(i) === group);
  const passed = by < 0 ? peers.filter((i) => items.indexOf(i) < at).pop() : peers.find((i) => items.indexOf(i) > at);
  if (!passed) return items;
  const rest = items.filter((_, n) => n !== at);
  const to = rest.indexOf(passed) + (by < 0 ? 0 : 1);
  return [...rest.slice(0, to), items[at], ...rest.slice(to)];
}

// The list as KEYS.openWith stores it: null while it is the default one (so a later default still
// reaches a person who never changed the list), else each item as itemOf writes it.
const canon = (list) => JSON.stringify(list.map(itemOf));
export const listValue = (items) => (canon(items) === canon(DEFAULT_ITEMS) ? null : items.map(itemOf).filter(Boolean));

// The three pickers: double-click (and Enter) on a file, the preview's Open ↗, and Open at a line.
export const PICKERS = ["double", "open", "line"];

// What a picker can choose besides the system default: the ticked items that open files.
const fileItems = (items) => items.filter((i) => i.enabled && fits(i, false));

// A picker's choices, { value, label, note }: "System default", then the ticked items that open
// files, in menu order. The line picker lists the ones that open at a line first; the others open
// the file without going to the line, and say so.
export function choicesOf(items, picker) {
  const system = { value: "system", label: "System default", note: "" };
  const choice = (i, note = "") => ({ value: i.id, label: i.name, note });
  const list = fileItems(items);
  if (picker !== "line") return [system, ...list.map((i) => choice(i))];
  return [system, ...list.filter((i) => i.argvLine).map((i) => choice(i)),
    ...list.filter((i) => !i.argvLine).map((i) => choice(i, "opens without the line"))];
}

// The settings with each picker that no longer names a ticked item for files put back to the system
// default (after an untick, a removal, or an edit that made it a folders program).
export function pickersFor(settings, items) {
  const ok = new Set(fileItems(items).map((i) => i.id));
  const out = { ...settings };
  for (const p of PICKERS) if (out[p] !== "system" && !ok.has(out[p])) out[p] = "system";
  return out;
}

// What to store for the Open with group after the list changed: its settings with the new list and
// its pickers checked; null when everything is the default again.
export const storedWith = (settings, items) => storedOf(KEYS.openWith, { ...pickersFor(settings, items), items: listValue(items) });

// An id for a program named `name`: lowercase letters, digits and dashes, not one the list or a known
// program uses already (then -2, -3, ...).
export function idFor(name, items) {
  const base = String(name).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "program";
  const taken = new Set([...KNOWN_BY_ID.keys(), ...items.map((i) => i.id)]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// The form for a program of the person's own, as typed: name, command, line (the command that opens
// at a line, optional), for (files | folders | both), kind (app: runs and leaves; pane: runs in a pane),
// remote (an app's command for a file on another machine, over ssh, with {host}; optional: without
// it the app is left out in spaces on other machines; a pane program runs there by itself).
export const blankDraft = () => ({ name: "", command: "", line: "", for: "files", kind: "app", remote: "" });

export const draftOf = (item) => ({
  name: item.name, command: joinCommand(item.argv), line: item.argvLine ? joinCommand(item.argvLine) : "", for: item.for, kind: item.kind,
  remote: item.remote ? joinCommand(item.remote.argv) : "",
});

// A leading ~ is the home folder, as a shell would have it (the commands run without one).
const homed = (argv, home) => (home ? [argv[0].replace(/^~(?=\/|$)/, home), ...argv.slice(1)] : argv);

// The item a draft makes, { item } or { error } (what to fix, in a few words). A command given by its
// path isn't looked for (cli ""), so menus show it as it is.
export function itemOfDraft(draft, id, home) {
  const name = String(draft.name ?? "").trim();
  if (!name) return { error: "Give it a name." };
  const argv = splitCommand(draft.command);
  if (argv === null) return { error: "The command has a quote that isn't closed." };
  if (!argv.length) return { error: "Type the command it runs." };
  const line = splitCommand(draft.line);
  if (line === null) return { error: "The line command has a quote that isn't closed." };
  // Only an app has one (a pane program runs on that machine itself).
  const remote = draft.kind === "app" ? splitCommand(draft.remote) : [];
  if (remote === null) return { error: "The command for another machine has a quote that isn't closed." };
  if (remote.length && !remote.some((a) => a.includes("{host}"))) return { error: "The command for another machine needs {host}, the machine's ssh target." };
  const run = homed(argv, home);
  const item = itemOf({
    id, name, kind: draft.kind, for: draft.for, argv: run,
    ...(line.length ? { argvLine: homed(line, home) } : {}),
    ...(remote.length ? { remote: { argv: homed(remote, home) } } : {}),
    ...(run[0].includes("/") ? { cli: "" } : {}),
  });
  return item ? { item } : { error: "That can't be saved." };
}

// Adds a program of the person's own at the end, ticked: { items, id } or { error }.
export function addOwn(items, draft, home) {
  const id = idFor(draft.name, items);
  const made = itemOfDraft(draft, id, home);
  return made.error ? made : { items: [...items, made.item], id };
}

// Changes one of the person's own programs in its place, ticked or not as it was: { items } or { error }.
export function editOwn(items, id, draft, home) {
  const old = items.find((i) => i.id === id);
  if (!old || !isOwn(old)) return { error: "It isn't in the list any more." };
  const made = itemOfDraft(draft, id, home);
  return made.error ? made : { items: items.map((i) => (i.id === id ? { ...made.item, enabled: old.enabled } : i)) };
}

export const removeOwn = (items, id) => items.filter((i) => i.id !== id || !isOwn(i));

// What a row says about a program on this computer, given what detection found (null: not yet):
// "found", "app" (only its app bundle is there: it opens without a line), "unchecked" (given by its
// path, so not looked for), "missing", or null while nobody has looked.
export function statusOf(item, found) {
  if (cliOf(item) === "" && !item.app) return "unchecked";
  if (!found) return null;
  const how = availability(item, found);
  if (!how) return "missing";
  const cli = cliOf(item);
  return how === "app" && cli && !found.cli.has(cli) && item.argvLine ? "app" : "found";
}

// The command a row shows: what the item runs (`open -a` when only its app bundle was found).
export function commandOf(item, found) {
  const cli = cliOf(item);
  if (found && item.kind === "app" && item.app && cli && !found.cli.has(cli) && found.app.has(item.app)) return joinCommand(["open", "-a", item.app, "{path}"]);
  return joinCommand(item.argv);
}

// What the menus show now, by name: for a file and for a folder (ticked, found, fitting, in order).
export const menusOf = (items, found) => ({
  files: menuItems(items, found, false).map((m) => m.item.name),
  folders: menuItems(items, found, true).map((m) => m.item.name),
});
