// An image's diff (images.js, gitops.js imageCopies): its before and after side by side, each with
// its pixel size and file size, in place of the diff. It gets its data, colors and callbacks.
import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { sideWords } from "./images.js";
import { chip } from "./look.js";

/** `copies`: { before, after } (null while they're copied); `dir`: where they are, from the app's
 *  folder ("cache/<mod>"); `labels`: what each side is ("HEAD", "index", "working tree");
 *  onText(cx): show the text diff instead (an SVG's), or null. */
export function imagePane({ t, path, copies, error, dir, labels, onText }) {
  const side = (id, title, copy, gone) => v_flex().id(id).flex_1().min_w(0).min_h(0).gap(6)
    .child(h_flex().gap(6).items_baseline().child(div().text_size(11.5).font_semibold().child(title)).child(div().text_size(10.5).text_color(t.dim).truncate().child(copy ? sideWords(copy) : gone)))
    .child(h_flex().flex_1().min_h(0).p(8).items_center().justify_center().overflow_hidden().rounded(8).border_1().border_color(t.border).bg(t.raised)
      .child(copy ? image(`${dir}/${copy.name}`).max_w_full().max_h_full() : div().text_size(11.5).text_color(t.dim).child(gone)));
  const pane = v_flex().id("image-view").flex_1().min_w(0).min_h(0).p(12).gap(10)
    .child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(path))
      .when(Boolean(onText), (e) => e.child(chip(t, "image-text", "Text diff", { tip: "Show the SVG's text diff instead", onClick: (_e, cx) => onText(cx) }))));
  if (error) return pane.child(div().text_size(11.5).text_color(t.ansi1).whitespace_normal().child(`Can't show this image: ${error}`));
  if (!copies) return pane.child(div().text_size(11.5).text_color(t.dim).child("Loading the image…"));
  return pane.child(h_flex().flex_1().min_h(0).gap(12)
    .child(side("image-before", `Before · ${labels.before}`, copies.before, "none (new file)"))
    .child(side("image-after", `After · ${labels.after}`, copies.after, "none (deleted)")));
}
