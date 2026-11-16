// Based on Herdr's shipped menu mod (Apache-2.0); changed: the Files panel's right-click menu. A popup
// copy of this mod with props { role: "menu", root, on, rel, dir, background, caps, found, host,
// links, repo, mark } for a row or the shown folder (background), or with `batch: [{ rel, dir }]` for
// several selected rows. With Git Enhanced installed (`links`), a row in a repository (`repo`:
// { root, path }) gets its links there: Show changes (a file with a git mark), File history, Folder
// history (reveal.js askChanges). ↑/↓ move, Enter runs, Esc closes; a line goes between groups. What a machine can't do isn't
// offered: on another machine there's no Open, Reveal or system app (only the editors that open files
// over ssh, openwith.js remoteMenuItems), and the sh items need sh there (caps).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, run, theme } from "herdr";
import { ID, asset } from "./id.js";
import { fullOf, parentOf, nameOf } from "./paths.js";
import { platform, capsOf } from "./machine.js";
import { openSystem, revealSystem, chooser, fileManager } from "./system.js";
import { openSettings, foundFrom, runItem, iconOf, chosen, programsFor, tryTo } from "./launch.js";
import { folderName } from "./pins.js";
import { outermost } from "./selection.js";
import { pastable, setClipboard, paste, duplicate } from "./clipboard.js";
import { MOVE_SIZE } from "./moveto.js";
import { closedNow } from "./menuat.js";
import { dialogHeight } from "./dialog.js";
import { openSettingsWindow } from "./settingsview.js";
import { openSend } from "./send.js";
import { askChanges } from "./reveal.js";

export const MENU_WIDTH = 250;
const icon = name => (name.includes("/") ? name : asset(`glyphs/${name}.svg`));
const onMac = () => platform() === "macos";
const chord = letter => (onMac() ? "⌘" : "Ctrl+") + letter;

// A dialog copy of this mod (dialog.js) for an action: newfile, newfolder, rename, compress, delete.
export function openDialog(action, p) {
  const given = { role: "dialog", action, root: p.root, on: p.on, rel: p.rel, dir: p.dir, items: p.items ?? null, caps: p.caps ?? null };
  openOverlay({ mod: ID, kind: "dialog", width: 440, height: dialogHeight(action, p.items), props: given });
}

// Move to…: a popup copy of this mod with the root's folders (moveto.js).
export function moveTo(p, items) {
  openOverlay({ mod: ID, kind: "popup", ...MOVE_SIZE, props: { role: "moveto", root: p.root, on: p.on, items } });
}

// The space's agent, asked about files and folders in this mod's own send dialog (send.js: a note,
// then `hc send` with the paths, or the settings' agent started with them).
function askAgent(title, targets) {
  openSend({ title, context: targets.map(x => `${x.dir ? "Folder" : "File"}: ${x.full}`).join("\n"), compact: true });
}

// Puts text on the system clipboard (the Copy path items).
const clip = text => cx => cx.write_to_clipboard(text);

// One row's menu, or the shown folder's (background): groups of { label, icon, run, hint?, wait? }.
function forOne(p) {
  const here = !p.on, caps = p.caps ?? capsOf(p.on), rel = p.rel ?? "", full = fullOf(p.root, rel);
  const folder = p.dir ? rel : parentOf(rel), isRow = rel !== "" && !p.background;
  const found = foundFrom(p.found), place = { on: p.on ?? null, host: p.host ?? null };
  const target = { path: full, dir: Boolean(p.dir), folder: fullOf(p.root, folder), name: nameOf(rel) || folderName(p.root) };
  // The "Open with" programs that can run for this place: editors and apps after Open, terminal programs
  // after Open terminal here. A double-click runs the `double` item when it can, else Open: the hint
  // goes to that one.
  const byDouble = p.dir ? null : chosen(openSettings().double, found, target, place);
  const programs = programsFor(found, Boolean(p.dir), place).map(m => ({
    kind: m.item.kind, label: m.label, icon: iconOf(m.item), hint: byDouble?.id === m.item.id ? "Double-click" : "",
    run: () => runItem(m.item, found, target, place),
  }));
  const apps = programs.filter(x => x.kind === "app"), terminals = programs.filter(x => x.kind === "pane");
  const terminalHere = { label: "Open terminal here", icon: "terminal", run: () => run("terminal.open", { place: "right", folder: target.folder }) };
  const agent = isRow ? [{ label: "Ask agent about this…", icon: "message", run: () => askAgent(rel, [{ full, dir: p.dir }]) }] : [];
  const show = here ? [{ label: `${p.dir ? "Open in" : "Reveal in"} ${fileManager()}`, icon: "folder", run: () => tryTo("Cannot open", () => revealSystem(full, p.dir)) }] : [];
  // Git Enhanced's pages for the row's repository, while it's installed.
  const repo = p.links && isRow ? p.repo : null, ask = page => () => askChanges({ root: repo.root, on: p.on ?? null, path: repo.path, page });
  const changes = !repo ? [] : [
    // Herdr's changes icon, as the tab bar's Changes button (by path: it ships with Herdr).
    ...(!p.dir && p.mark ? [{ label: "Show changes", icon: "mods/changes/changes.svg", run: ask("changes") }] : []),
    // History's clock, as on the tab bar and History's tab (Herdr's workspace-chrome icon).
    { label: p.dir ? "Folder history" : "File history", icon: "mods/workspace-chrome/clock.svg", run: ask("history") },
  ];
  const out = [];
  if (p.dir) out.push([...show, ...apps, terminalHere, ...terminals, ...agent], changes);
  else {
    const opening = here ? [{ label: "Open", icon: "monitor", hint: byDouble ? "" : "Double-click", run: () => tryTo("Cannot open", () => openSystem(full)) }] : [];
    if (here && platform() === "windows") opening.push({ label: "Open with…", icon: "square", run: () => tryTo("Cannot open", () => chooser(full)) });
    out.push([...opening, ...apps], [...show, terminalHere, ...terminals, ...agent], changes);
  }
  const into = { ...p, rel: folder, dir: true };
  out.push([{ label: "New file…", icon: "plus", run: () => openDialog("newfile", into) }, { label: "New folder…", icon: "folder-plus", run: () => openDialog("newfolder", into) }]);
  // The file clipboard (clipboard.js): Paste goes into the folder (a file's: its folder). Each has an
  // icon of its own (Lucide's): x is a close, as in Herdr's menus.
  if (caps.shell) {
    const files = [];
    if (isRow) files.push({ label: "Cut", icon: "scissors", hint: chord("X"), run: () => setClipboard("cut", [full], p.on) }, { label: "Copy", icon: "copy", hint: chord("C"), run: () => setClipboard("copy", [full], p.on) });
    if (pastable(p.on)) files.push({ label: "Paste", icon: "clipboard-paste", hint: chord("V"), wait: true, run: () => paste(p.root, p.on, folder) });
    if (isRow) files.push({ label: "Duplicate", icon: "copy-plus", wait: true, run: () => duplicate(p.root, p.on, rel) }, { label: "Move to…", icon: "folder", run: () => moveTo(p, [{ rel, dir: Boolean(p.dir) }]) });
    out.push(files);
  }
  const copies = [{ label: "Copy path", icon: "copy", run: clip(full) }];
  if (rel) copies.push({ label: "Copy relative path", icon: "copy", run: clip(rel) }, { label: "Copy name", icon: "copy", run: clip(nameOf(rel)) });
  out.push(copies);
  if (isRow) {
    const changing = caps.zip ? [{ label: "Compress…", icon: "archive", run: () => openDialog("compress", { ...p, items: [{ rel, dir: Boolean(p.dir) }] }) }] : [];
    changing.push({ label: "Rename…", icon: "square-pen", hint: "F2", run: () => openDialog("rename", p) });
    changing.push({ label: here || caps.trash ? "Delete" : "Delete permanently", icon: "trash", hint: onMac() ? "⌘⌫" : "Del", run: () => openDialog("delete", p) });
    out.push(changing);
  }
  // The shown folder's menu (the background, the header's ⋯): the panel's settings window.
  if (p.background) out.push([{ label: "Settings…", icon: "settings", run: () => openSettingsWindow("files") }]);
  return out;
}

// Several selected rows: the outermost of them (a folder takes what's in it).
function forSeveral(p) {
  const caps = p.caps ?? capsOf(p.on), keep = new Set(outermost(p.batch.map(b => b.rel)));
  const batch = p.batch.filter(b => keep.has(b.rel)), n = batch.length;
  const targets = batch.map(b => ({ full: fullOf(p.root, b.rel), dir: b.dir })), fulls = targets.map(x => x.full);
  const first = caps.shell ? [{ label: "Cut", icon: "scissors", hint: chord("X"), run: () => setClipboard("cut", fulls, p.on) }, { label: "Copy", icon: "copy", hint: chord("C"), run: () => setClipboard("copy", fulls, p.on) }] : [];
  first.push({ label: "Copy paths", icon: "copy", run: clip(fulls.join("\n")) });
  const second = [];
  if (caps.zip) second.push({ label: "Compress…", icon: "archive", run: () => openDialog("compress", { ...p, items: batch }) });
  if (caps.shell) second.push({ label: "Move to…", icon: "folder", run: () => moveTo(p, batch) });
  second.push({ label: "Ask agent about these…", icon: "message", run: () => askAgent(`${n} items`, targets) });
  const gone = !p.on || caps.trash ? `Delete ${n} items…` : `Delete ${n} items permanently…`;
  return [first, second, [{ label: gone, icon: "trash", hint: onMac() ? "⌘⌫" : "Del", run: () => openDialog("delete", { ...p, items: batch }) }]];
}

// The menu's items in order, each knowing whether a line goes above it (the first of a group).
export function menuItems(p) {
  const groups = (p.batch ? forSeveral(p) : forOne(p)).filter(g => g.length);
  return groups.flatMap((g, i) => g.map((x, k) => ({ ...x, line: i > 0 && k === 0 })));
}
// The same, with null where a line goes (for tests and anyone reading the order).
export const items = p => menuItems(p).flatMap(x => (x.line ? [null, x] : [x]));
// Herdr's menu: 5px padding around 31px rows, 9px for a line.
export const menuHeight = p => menuItems(p).reduce((h, x) => h + 31 + (x.line ? 9 : 0), 10);

export class Menu {
  constructor(view, cx) {
    this.view = view;
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  // Herdr closed the popup: the page whose button opened it stops lighting it (menuat.js).
  close() { closedNow(props()?.overlay); }

  // Runs an item, then closes. One that copies or moves files (wait) keeps the menu until it's done:
  // closing the popup would cancel its work.
  choose(i, cx) {
    const it = menuItems(props() ?? {})[i];
    if (!it || this.waiting) return;
    const done = it.run(cx);
    if (it.wait && done?.then) {
      this.waiting = it.label; cx.notify();
      done.finally(() => closeOverlay(props()?.overlay));
      return;
    }
    closeOverlay(props()?.overlay);
  }

  render() {
    const t = theme();
    const list = menuItems(props() ?? {});
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(it.line, el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            .when(this.waiting === it.label, el => el.opacity(0.7))
            .hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(icon(it.icon)).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it.label))
            .child(div().text_size(11).text_color(t.muted).child(it.hint ?? ""))),
        ),
      );
  }
}
