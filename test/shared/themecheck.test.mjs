// The theme check itself (themecheck.mjs): WCAG's ratio, what text is drawn on (bg colors composited,
// an opacity fading what it holds), which colors are the theme's, what each kind of text needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES, rgba, over, contrast, needs, themeProblems } from "./themecheck.mjs";

// Elements as the render stubs record them: { $: { kind, id, calls, children } }.
const el = (id, calls = [], children = [], kind = "div") => ({ $: { kind, id, calls: Object.entries(calls).map(([m, a]) => [m.replace(/#.*/, ""), [a]]), children } });
const theme = { name: "t", light: false, colors: { surface: "#000000", foreground: "#ffffff", dim: "#777777", muted: "#999999", popover: "#222222", accent: "#3366ff", hover: "#ffffff20", ring: "#333333" } };

test("contrast: WCAG's ratios, and colors with an alpha over what is under them", () => {
  assert.equal(contrast(rgba("#000"), rgba("#fff")).toFixed(2), "21.00");
  assert.equal(contrast(rgba("#777777"), rgba("#ffffff")).toFixed(2), "4.48");
  assert.deepEqual(over(rgba("#ffffff80"), rgba("#000000")).map((x) => +x.toFixed(2)), [0.5, 0.5, 0.5, 1]);
  assert.deepEqual(rgba("#abc"), rgba("#aabbcc"));
});

test("what each kind of text needs follows the theme's own foreground and dim on its surface", () => {
  const n = needs(theme.colors);
  assert.equal(n.normal, 4.5);
  assert.equal(n.dim, 3);
  const graphite = needs(THEMES.find((t) => t.name === "graphite").colors), win98 = needs(THEMES.find((t) => t.name === "win98").colors);
  assert.ok(graphite.disabled > 2.9 && graphite.disabled < 3);
  assert.ok(win98.dim > 2 && win98.dim < 2.1, "win98's dim is 2.2 on its surface: 0.95 of it");
  assert.equal(THEMES.length, 6);
});

test("text reads on the bg colors up the tree, the root's over the surface; dim text needs less; a fade counts", () => {
  const tree = el("root", { bg: "#000000" }, [
    el("ok", { text_color: "#ffffff" }, ["fine"]),
    el("card", { bg: "#222222" }, [el("hint", { text_color: "#777777" }, ["a hint"]), el("bad", { text_color: "#333333" }, ["unreadable"])]),
    el("off", { opacity: 0.3 }, [el("faded", { text_color: "#999999" }, ["disabled"])]),
    el("tint", { bg: "#3366ff40" }, ["default color"]),
  ]);
  const found = themeProblems(tree, theme);
  assert.equal(found.length, 2, found.join("\n"));
  assert.ok(!found.some((p) => /hint/.test(p)), "dim on the card: 3.6, enough for dim text");
  assert.ok(found.some((p) => /bad: #333333 on #222222: 1\.\d\d < 4\.50 \(normal\) "unreadable"/.test(p)));
  assert.ok(found.some((p) => /faded: #999999 on #000000: [\d.]+ < [\d.]+ \(disabled: faded by an opacity\) "disabled"/.test(p)));
  assert.ok(!found.some((p) => /root › ok|tint/.test(p)), "white on black, white on a light tint over black");
});

test("only the theme's colors, or one of them at another alpha; a closed popover's content isn't drawn", () => {
  const tree = el("root", { bg: "#000000", "border_color": "#ffffff40" }, [
    el("own", { text_color: "#3366ff80" }, ["x"]),
    el("hex", { text_color: "#ff0000" }, ["y"]),
    { $: { kind: "popover", id: null, calls: [["open", [false]]], children: [el("trigger", {}, ["z"]), el("inside", { text_color: "#333333" }, ["hidden"])], contentEl: null } },
  ]);
  tree.$.children[2].$.contentEl = tree.$.children[2].$.children[1];
  const found = themeProblems(tree, theme, { allow: ["#ff0000"] });
  assert.deepEqual(found.filter((p) => /not one of/.test(p)), []);
  assert.ok(themeProblems(tree, theme).some((p) => /hex: text_color #ff0000 is not one of the theme's colors/.test(p)));
  assert.ok(!found.some((p) => /inside/.test(p)), "closed: not drawn");
});

test("a hover that changes the text's color or fills opaquely is read; the theme's tint isn't", () => {
  const style = () => { const d = { kind: "style", id: null, calls: [], children: [] }; const p = new Proxy(d, { get: (t, k) => (k === "$" ? t : (...a) => { t.calls.push([k, a]); return p; }) }); return p; };
  const row = (id, fn) => ({ $: { kind: "div", id, calls: [["hover", [fn]]], children: ["row"] } });
  const tree = el("root", { bg: "#000000" }, [row("tinted", (s) => s.bg("#ffffff20")), row("filled", (s) => s.bg("#ffffff")), row("inked", (s) => s.text_color("#222222"))]);
  const found = themeProblems(tree, theme, { style });
  assert.ok(found.some((p) => /filled \(hover\): #ffffff \(default\) on #ffffff/.test(p)), found.join("\n"));
  assert.ok(found.some((p) => /inked \(hover\): #222222 on #000000/.test(p)));
  assert.ok(!found.some((p) => /tinted/.test(p)));
});
