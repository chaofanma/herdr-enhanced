// The panel's tab header, for a layout stack's "header": the stack's children as tabs, drawn like
// Herdr's own Files and Changes buttons in the main layout's tab bar (mods/tabs): 12 px text after a
// 14 px icon, 26 px high, the shown child on `selected`; a click shows that child (layout.select). No
// gear: each page has its own (the settings window, settingsview.js), there wherever the page is (a
// layout with no header, a window, a tab). Either mod draws it, the same, when a layout names it as a
// stack's header:
//   "header": { "content": { "mod": "git-enhanced", "props": { "role": "tabs", "stack": "panel-body" } }, "height": 34 }
// Props: stack (the stack's id, default "panel-body"); icons ({ "<child id>": "mods/x/y.svg" }, over
// the ones for files, changes and history). Titles: each child's "title", else its id. The icons are
// Herdr's own (its Files and Changes mods', its workspace-chrome's), as its tab bar draws them.
// Shared: the same file in both mods (shared/, tools/copy-shared.mjs).
import { svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, layout, props, run } from "herdr";

const ICONS = { files: "mods/files/file.svg", changes: "mods/changes/changes.svg", history: "mods/workspace-chrome/clock.svg" };

/** The node of layout `tree` with id `id`, or null. */
export function findNode(tree, id) {
  if (tree?.id === id) return tree;
  for (const child of tree?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** The tabs of stack `node`: [{ id, title, on }], the shown child on (its `active`, else the first). */
export function tabsOf(node) {
  const children = (node?.children ?? []).filter((c) => c?.id);
  const active = node?.active ?? children[0]?.id;
  return children.map((c) => ({ id: c.id, title: c.title ?? c.id, on: c.id === active }));
}

// A press on a tab is its own: in a window_drag block it would move the window.
const stop = (_e, cx) => cx.stop_propagation();

export class PanelTabs {
  constructor(_cx) {}

  render() {
    const t = theme(), p = props() ?? {}, stack = p.stack ?? "panel-body", icons = { ...ICONS, ...(p.icons ?? {}) };
    return h_flex().id("panel-tabs").size_full().min_w(0).px(4).gap(3).items_center().overflow_hidden()
      .children(tabsOf(findNode(layout(), stack)).map(({ id, title, on }) => h_flex().id(`panel-tab-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .role("tab").accessibility_label(title)
        .on_mouse_down("left", stop)
        .on_click(() => { if (!on) run("layout.select", { stack, child: id }); })
        .when(Boolean(icons[id]), (el) => el.child(svg(icons[id]).size(14)))
        .child(title)));
  }
}
