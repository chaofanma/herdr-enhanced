// Based on Herdr's shipped Files mod (Apache-2.0); changed: Files Enhanced, a file browser for Herdr's
// panel (or any block): the focused terminal's folder, on this computer or on the space's machine, as a
// tree with git marks, a preview that edits, search in names and contents, a right-click menu, dialogs,
// several selected rows and a file clipboard. One default export for every role this mod plays: the
// tree, or a copy of it opened as its menu, a dialog, the roots popup or Move to (props().role); the
// tree in a window of its own (mod.open: props only { overlay }, window.js); and the parts both
// panel mods share (shared/): the panel's tab header, the settings window and the send dialog ("Ask
// agent about this…").
import { View } from "gpui-kit";
import { props } from "herdr";
import { Tree } from "./tree.js";
import { Menu } from "./menu.js";
import { Dialog } from "./dialog.js";
import { Roots } from "./roots.js";
import { MoveTo } from "./moveto.js";
import { PanelTabs } from "./paneltabs.js";
import { SettingsWindow } from "./settingsview.js";
import { SendDialog } from "./send.js";
import { FilesWindow, isWindow } from "./window.js";

const ROLES = { menu: Menu, dialog: Dialog, roots: Roots, moveto: MoveTo };
// The shared parts take only the cx.
const SHARED = { tabs: PanelTabs, settings: SettingsWindow, send: SendDialog };

export default class FilesEnhanced extends View {
  init(_props, cx) {
    const p = props(), role = p?.role;
    this.role = SHARED[role] ? new SHARED[role](cx) : ROLES[role] ? new ROLES[role](this, cx) : isWindow(p) ? new FilesWindow(this, cx) : new Tree(this, cx);
  }

  render(cx) { return this.role.render(cx); }

  // This copy goes (a window closed, the app quits): the settings window saves what waits.
  async close(cx) { await this.role.close?.(cx); }
}
