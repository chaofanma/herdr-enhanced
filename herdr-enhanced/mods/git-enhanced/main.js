// Git Enhanced: the panel's Changes and History pages, the Review and History tabs, and the dialogs
// and menus they open, each a copy of this mod whose props say which: a question or menu
// (question.js), a commit's menu and dialogs (commitmenu.js), the interactive rebase's editor
// (rebaseedit.js), a turn's revert (turnrec.js), a History page (props.view "history"), the window
// mod.open opens (props only { overlay }: both pages under a bar, window.js), else the Changes page
// (changes.js; the Review tab with props.review; a layout block's under Changes | History where no tab
// header of ours leads to History, block.js). And the parts both panel mods share
// (shared/), by props.role: the panel's tab header ("tabs"), the settings window ("settings") and
// the send dialog ("send", send.js).
// Based on Herdr's shipped changes mod (Apache-2.0); changed.
import { View } from "gpui-kit";
import { props } from "herdr";
import { ChangesPage } from "./changes.js";
import { HistoryPage } from "./historypage.js";
import { Question } from "./question.js";
import { CommitOverlay, isCommitOverlay } from "./commitmenu.js";
import { TurnOverlay, isTurnOverlay } from "./turnrec.js";
import { SendDialog } from "./send.js";
import { RebaseEditor, isRebaseOverlay } from "./rebaseedit.js";
import { PanelTabs } from "./paneltabs.js";
import { SettingsWindow } from "./settingsview.js";
import { ChangesWindow, isWindow } from "./window.js";
import { BlockSwitch, isBlock } from "./block.js";
import { restoreClosedTabs, CLOSED_TAB_POLL } from "./tabs.js";
import { ID } from "./id.js";

// The shared parts, made with the cx alone.
const SHARED = { tabs: PanelTabs, settings: SettingsWindow, send: SendDialog };

// The part a copy is, from its props; each has init(props, cx) or init(cx), render(cx) and maybe close.
function partOf(p) {
  if (p?.question) return { part: new Question(), overlay: true };
  if (isCommitOverlay(p)) return { part: new CommitOverlay(), overlay: true };
  if (isTurnOverlay(p)) return { part: new TurnOverlay(), overlay: true };
  if (isRebaseOverlay(p)) return { part: new RebaseEditor(), overlay: true };
  if (p?.view === "history") return { part: new HistoryPage(), overlay: false };
  if (isWindow(p)) return { part: new ChangesWindow(), overlay: false };
  return { part: new ChangesPage(), overlay: false };
}

export default class GitEnhanced extends View {
  init(initial, cx) {
    const Shared = SHARED[props()?.role];
    if (Shared) { this.part = new Shared(cx); return; }
    const { part, overlay } = partOf(props());
    this.part = part;
    if (overlay) part.init(initial, cx); else part.init(cx);
    // A layout block's Changes page: the switch around it (it draws the page alone under our header).
    if (part instanceof ChangesPage && isBlock(props())) this.block = new BlockSwitch(part);
    // A page in the layout (not a tab's, not the window's) brings the panel back when a tab it gave
    // way to is closed another way than ⤡ (tabs.js). It runs hidden too.
    const p = props();
    if ((part instanceof ChangesPage || part instanceof HistoryPage) && !p?.root && !p?.review && !isWindow(p)) cx.timer.every(CLOSED_TAB_POLL, () => restoreClosedTabs(ID));
  }

  render(cx) { const shown = this.block ?? this.part; return shown.render(cx); }

  // This copy goes: a question it showed counts as cancelled (question.js).
  async close(cx) { const shown = this.block ?? this.part; shown.gone?.(); await shown.close?.(cx); }
}
