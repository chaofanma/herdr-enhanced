// The commit bar: the message box (it grows with its lines; the pen beside it), Amend, ⋯ (undo and
// recently discarded), Commit and Push. A narrow panel gives the message box its own row; a wide one
// keeps the pen and the buttons on the box's last row. Sized as Herdr's tab bar: 26 px tall, 12 px
// words, radius 6; ⋯ and the pen icon buttons as the pages' others (iconbutton.js).
// Based on Herdr's shipped changes mod (Apache-2.0); changed: the commit row (message box and Commit).
import { h_flex, v_flex, Textarea } from "gpui-base";
import { div, svg } from "gpui-kit";
import { asset } from "./id.js";
import { CLEAR } from "./look.js";
import { iconButton } from "./iconbutton.js";

/** The ⋯ by Commit's tooltip: what its menu (undoui.js moreMenuFlow) holds. */
export const MORE_TIP = "Undo the last commit or git action, move unpushed commits to a new branch, copy or apply a patch, recently discarded changes, settings";

/** What Push does and says, from the branch's facts (reads.js parseRepo): { label, enabled, tip,
 *  publish }. `busy`: the push running. */
export function pushState(p, { busy = false, idle = true } = {}) {
  if (!p?.head) return { label: "Push", enabled: false, tip: "Nothing committed yet", publish: false };
  if (!p.branch) return { label: "Push", enabled: false, tip: "Detached HEAD: no branch to push", publish: false };
  const publish = !p.upstream;
  if (publish && !p.remote) return { label: "Push", enabled: false, tip: "This repository has no remote", publish };
  const label = busy ? (publish ? "Publishing…" : "Pushing…") : publish ? "Publish" : p.ahead ? `Push ↑${p.ahead}` : "Push";
  if (publish) return { label, enabled: idle, tip: `Publish ${p.branch}: git push -u ${p.remote} HEAD, then it tracks ${p.remote}/${p.branch}`, publish };
  if (!p.ahead) return { label, enabled: false, tip: `Up to date with ${p.upstream}`, publish };
  return { label, enabled: idle, tip: `git push: ${p.ahead} commit${p.ahead === 1 ? "" : "s"} to ${p.upstream}`, publish };
}

const button = (t, id, label, { enabled, tip, primary = false, onClick }) => div().id(id).h(26).px(10).flex().flex_none().items_center().rounded(6).text_size(12)
  .bg(enabled && primary ? t.solid : t.raised).text_color(enabled ? (primary ? t.solid_foreground : t.foreground) : t.muted)
  .when(enabled, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx))).when(Boolean(tip), (e) => e.tooltip(tip)).child(label);

/** The bar. `o`: { narrow, input (the message box's TextareaState), typing, pen ({ busy, label, tip,
 *  onClick, onMenu } or null: no agent here), amend ({ ok, on, onToggle }), more ({ idle, onClick }),
 *  commit ({ enabled, label, tip, onClick }), push (pushState's and onClick), pushMenu (an element
 *  beside Push, or null) }. */
export function commitBar(t, o) {
  const message = h_flex().gap(8).items_end().when(o.narrow, (e) => e.w_full()).when(!o.narrow, (e) => e.flex_1().min_w(0))
    .child(v_flex().id("commit-message").flex_1().min_w(0).min_h(26).px(10).py(4).justify_center().rounded(6).border_1().border_color(o.typing ? t.accent : t.border).cursor_text()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Textarea.new(o.input).w_full().text_size(12).text_color(t.foreground)))
    .when(Boolean(o.pen), (e) => e.child(penButton(t, o.pen)));
  const commit = button(t, "commit", o.commit.label, { enabled: o.commit.enabled, tip: o.commit.tip, primary: true, onClick: o.commit.onClick });
  const push = h_flex().flex_none().gap(2).child(button(t, "push", o.push.label, { enabled: o.push.enabled, tip: o.push.tip, onClick: o.push.onClick }))
    .when(Boolean(o.pushMenu), (e) => e.child(o.pushMenu));
  // While its menu is open a button has no tooltip (it would show over the menu); its label stays.
  const more = iconButton(t, "commit-more", div().text_size(14).child("⋯"), (cx) => o.more.onClick(cx),
    { tip: o.more.open ? null : MORE_TIP, label: MORE_TIP, off: !o.more.idle, menu: true, on: Boolean(o.more.open) });
  const bar = (o.narrow ? v_flex() : h_flex().items_end()).flex_none().p(10).gap(8).border_t(1).border_color(t.border);
  if (!o.narrow) return bar.child(message).child(amendBox(t, o.amend)).child(more).child(commit).child(push);
  return bar.child(message).child(h_flex().gap(8).items_center().child(amendBox(t, o.amend)).child(more).child(div().flex_1()).child(commit).child(push));
}

// Amend: a box by Commit; on, the last commit's message is in the box and Commit rewrites it.
function amendBox(t, { ok, on, busy, onToggle }) {
  return h_flex().id("amend").h(26).px(8).gap(6).flex_none().items_center().rounded(6).text_size(12).text_color(on ? t.foreground : t.muted)
    .when(ok && !busy, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => onToggle(cx)))
    .when(!ok, (e) => e.opacity(0.7))
    .tooltip(ok ? "Amend the last commit: its message comes into the box, and Commit rewrites it" : "Nothing committed to amend")
    .child(div().size(14).flex().items_center().justify_center().rounded(3).border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent : CLEAR)
      .when(on, (e) => e.child(svg(asset("check.svg")).size(10).text_color(t.accent_foreground))))
    .child("Amend");
}

// The pen: an agent writes the message (it fills the box, never commits); "Writing…" meanwhile.
// A right-click picks another agent found on this computer. Its icon is Lucide's sparkles (the
// pen, square-pen, is Rename's in Files' menu and Herdr's).
function penButton(t, { busy, open, tip, label, onClick, onMenu }) {
  if (open) tip = null;
  const menu = (e) => e.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); onMenu(cx); });
  if (busy) return menu(h_flex().id("commit-write").role("button").accessibility_label(label).h(24).px(6).flex_none().items_center().text_size(12).text_color(t.muted).tooltip(tip).child("Writing…"));
  return menu(iconButton(t, "commit-write", asset("sparkles.svg"), (cx) => onClick(cx), { tip, label }));
}
