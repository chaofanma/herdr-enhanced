// Answering the questions and menus a page asks in the render tests (question.js copies of the mod).
import assert from "node:assert/strict";
import { state, overlay, drawWith, byId, handler, settle, makeCx } from "./render/load.mjs";

/** Answers the last question: `set(part)` fills the form; then Confirm, a menu item (`pick`), or
 *  cancel, or an entry's button (`entry`: its index). Returns { spec, tree }. */
export async function answer({ set = () => {}, cancel = false, pick = null, entry = null } = {}) {
  await settle();
  const spec = state.overlays.at(-1);
  assert.ok(spec?.props?.question, "a question was asked");
  const saved = state.props, { view: q, props } = overlay(spec);
  set(q.part);
  const tree = drawWith(q, props);
  if (pick) assert.ok(byId(tree, `menu-${pick}`), `menu item ${pick} is there (${spec.props.question.items?.map((i) => i.id)})`);
  state.props = props;
  const id = pick ? `menu-${pick}` : entry !== null ? `question-entry-button-${entry}` : "question-confirm";
  if (cancel) await q.close(); else handler(byId(tree, id), "on_click")({}, makeCx());
  state.props = saved;
  await settle();
  return { spec: spec.props.question, tree };
}
/** The number of overlays opened so far (a later answer() must find a new one). */
export const asked = () => state.overlays.length;
