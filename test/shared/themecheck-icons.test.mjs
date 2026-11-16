// The theme check reads icons too (an svg, drawn in the nearest text_color up the tree, as Herdr
// draws them): an icon button has no words, its icon is all it shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rgba, contrast, needs, themeProblems } from "./themecheck.mjs";

// Elements as the render stubs record them: { $: { kind, id, calls, children } }, an svg with its path.
const el = (id, calls = [], children = [], kind = "div", more = {}) => ({ $: { kind, id, calls: Object.entries(calls).map(([m, a]) => [m.replace(/#.*/, ""), [a]]), children, ...more } });
const icon = (path, calls = {}) => el(null, calls, [], "svg", { path });
const theme = { name: "t", light: false, colors: { surface: "#000000", foreground: "#ffffff", dim: "#777777", muted: "#999999", raised: "#555555", popover: "#222222", accent: "#3366ff", hover: "#ffffff20" } };
const ratio = (a, b) => contrast(rgba(a), rgba(b)).toFixed(2);

test("an icon in dim on a card it doesn't read on is found, as dim words are, by its file's name", () => {
  const need = needs(theme.colors);
  const found = themeProblems(el("card", { bg: "#555555" }, [el("menu", { text_color: "#777777" }, [icon("mods/workspace-chrome/chevron-down.svg")])]), theme);
  assert.deepEqual(found, [`t: card › menu: #777777 on #555555: ${ratio("#777777", "#555555")} < ${need.dim.toFixed(2)} (dim) "chevron-down.svg"`]);
  // The same mark as words: the same problem but for the words (a problem without them is the same).
  const words = themeProblems(el("card", { bg: "#555555" }, [el("menu", { text_color: "#777777" }, ["▾"])]), theme);
  assert.deepEqual(words.map((p) => p.replace(/ "[^"]*"$/, "")), found.map((p) => p.replace(/ "[^"]*"$/, "")));
});

test("an icon takes its own color, else the nearest text_color up the tree, else the foreground", () => {
  assert.deepEqual(themeProblems(el("row", { text_color: "#777777" }, [icon("x.svg", { text_color: "#ffffff" })]), theme), [], "its own color");
  assert.equal(themeProblems(el("card", { bg: "#555555" }, [el("row", { text_color: "#777777" }, [el("wrap", {}, [icon("x.svg")])])]), theme).length, 1, "the row's dim");
  assert.deepEqual(themeProblems(el("card", { bg: "#555555" }, [icon("x.svg")]), theme), [], "the foreground");
});

test("an icon needs what isn't words needs (WCAG's 3:1, as dim words): accent is too faint for words here, not for an icon", () => {
  assert.ok(Number(ratio("#3366ff", "#000000")) < 4.5 && Number(ratio("#3366ff", "#000000")) >= 3);
  assert.equal(themeProblems(el("row", { text_color: "#3366ff" }, ["Push"]), theme).length, 1, "the words");
  assert.deepEqual(themeProblems(el("row", { text_color: "#3366ff" }, [icon("check.svg")]), theme), [], "the icon");
});

test("an icon faded by an opacity (a control that waits) needs what faded words need", () => {
  const need = needs(theme.colors);
  const found = themeProblems(el("off", { opacity: 0.3 }, [icon("trash.svg")]), theme);
  assert.equal(found.length, 1);
  assert.match(found[0], new RegExp(`< ${need.disabled.toFixed(2)} \\(disabled: faded by an opacity\\) "trash.svg"$`));
  assert.deepEqual(themeProblems(el("off", { opacity: 0.7 }, [icon("trash.svg")]), theme), [], "0.7 of the foreground reads");
});
