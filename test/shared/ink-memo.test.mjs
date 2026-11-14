// readable() keeps its answers (a list asks the same few questions for every row): the same answer as
// before for the same arguments, and a new one when what it depends on changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readable, contrast } from "../../shared/ink.js";

const dark = { surface: "#17191d", foreground: "#e6e6e6" }, light = { surface: "#ffffff", foreground: "#1e1e1e" };

test("readable: kept answers equal fresh ones, and follow the theme, the color and the backgrounds", () => {
  // A green that reads on dark, not on white.
  assert.equal(readable(dark, "#4caf50"), "#4caf50");
  assert.equal(readable(dark, "#4caf50"), "#4caf50", "asked again");
  assert.equal(readable(light, "#4caf50"), light.foreground, "another theme: its own answer");
  assert.ok(contrast("#4caf50", "#ffffff", "#ffffff") < 4.5);
  // The foreground it falls back to is the theme's at the time.
  assert.equal(readable({ ...light, foreground: "#000000" }, "#4caf50"), "#000000");
  // Other backgrounds, another answer.
  assert.equal(readable(dark, "#4caf50", ["#ffffff"]), dark.foreground);
  // On a tinted row (white at 13% over the surface) the green no longer reads: 4.25 to 1.
  assert.equal(readable(dark, "#4caf50", [dark.surface, ["#17191d", "#ffffff22"]]), dark.foreground);
  assert.equal(readable(dark, "#4caf50", [dark.surface]), "#4caf50", "on the surface alone it does");
  // A list of colors: the first that reads.
  assert.equal(readable(light, ["#4caf50", "#2e7d32"]), "#2e7d32");
});
