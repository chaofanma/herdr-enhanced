// History's search box shows whether it has the keys: its border `accent` while it does, `input` else.
// It was drawn lit before anyone clicked it (ui.js field() takes a missing `focused` for focused, and
// the page's `searching` was undefined until a first focus), and it learned of focus and blur without
// asking for a draw, so after a click elsewhere it kept the lit border until something else drew.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, settle, makeCx } from "./render/load.mjs";
import { THEMES } from "../shared/themecheck.mjs";

const fire = (s, ev) => { for (const fn of s.handlers[ev] ?? []) fn({}, makeCx()); };
const border = (tree) => byId(tree, "history-search").calls.findLast(([m]) => m === "border_color")?.[1][0];

test("history search: plain until it has the keys, lit while it does, plain again after; each change drawn", async () => {
  // A theme of Herdr's: the stubs' default gives every color one value, accent and input alike.
  const was = state.palette;
  state.palette = THEMES[0].colors;
  const { accent, input } = state.palette;
  const r = repo(({ write, git }) => { write("a.txt", "1\n"); git("add", "-A"); git("commit", "-qm", "One"); });
  const view = await mount(r.dir, { palette: "theme", view: "history" });
  await settle();
  const s = view.part.history.search;
  assert.equal(border(await draw(view)), input, "not lit before it was clicked");
  let n = state.notified;
  fire(s, "focus");
  assert.ok(state.notified > n, "focus asks for a draw");
  assert.equal(border(await draw(view)), accent, "lit while it has the keys");
  n = state.notified;
  fire(s, "blur");
  assert.ok(state.notified > n, "blur asks for a draw");
  assert.equal(border(await draw(view)), input, "plain again");
  state.palette = was;
  assert.deepEqual(state.violations, []);
});
