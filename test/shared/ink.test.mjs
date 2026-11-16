// shared/ink.js: a color is kept where it reads on its background, else the theme's foreground.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, readable } from "../../shared/ink.js";
import { THEMES } from "./themecheck.mjs";

const theme = (name) => THEMES.find((x) => x.name === name).colors;

test("contrast: WCAG's ratio, a background with an alpha over the base", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#ffffff", "#ffffff00", "#000000").toFixed(2), "21.00", "a clear background: the base shows");
  assert.equal(contrast("#777777", "#fff").toFixed(2), "4.48");
  assert.equal(contrast("nope", "#fff"), null);
  assert.equal(contrast("#000000", ["#ffffff", "#00000000"]).toFixed(2), "21.00", "layers, each over the one under it");
  assert.equal(contrast("#ffffff", ["#ffffff", "#000000"]).toFixed(2), "21.00");
});

test("readable: the color where it reads on each background, else the foreground", () => {
  const graphite = theme("graphite"), win98 = theme("win98"), atom = theme("atom-one-dark");
  assert.equal(readable(graphite, graphite.ansi2), graphite.ansi2, "graphite's green on its surface");
  assert.equal(readable(win98, win98.ansi2), win98.foreground, "win98's green on silver: 1.7");
  assert.equal(readable(win98, win98.ansi4), win98.ansi4, "its blue reads");
  assert.equal(readable(atom, atom.ansi1), atom.ansi1, "atom-one-dark's red on its surface: 4.8");
  assert.equal(readable(atom, atom.ansi1, atom.popover), atom.foreground, "on a popover: 4.0");
  assert.equal(readable(win98, win98.ansi4, [win98.surface, win98.hover]), win98.ansi4, "every background");
  assert.equal(readable(graphite, graphite.ansi2, [[graphite.surface, "#ffffffee"]]), graphite.foreground, "on a near-white layer over the surface");
  assert.equal(readable(graphite, graphite.dim, graphite.surface, 3), graphite.dim, "a lower bar for hints");
  assert.equal(readable(graphite, "not a color"), "not a color");
  assert.equal(readable(win98, [win98.foreground, win98.accent_foreground], win98.selection), win98.accent_foreground, "the first of a list that reads: white on win98's navy");
  assert.equal(readable(graphite, [graphite.foreground, graphite.accent_foreground], graphite.selection), graphite.foreground);
});
