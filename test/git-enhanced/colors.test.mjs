import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";

const { PALETTES, palette, themeColors, isLight } = await mod("colors.js");
const theme = Object.fromEntries(["dim", ...Array.from({ length: 16 }, (_, i) => `ansi${i}`)].map((k) => [k, `#${k}`]));
const CLASSES = ["comment", "string", "keyword", "number", "type", "function", "constant", "tag", "attr", "added", "removed"];

test("every palette colors every token class and both tints", () => {
  for (const p of [...Object.values(PALETTES), themeColors(theme)]) assert.deepEqual(Object.keys(p).sort(), [...CLASSES].sort());
  for (const p of Object.values(PALETTES)) for (const c of Object.values(p)) assert.match(c, /^#[0-9a-f]{6}$/);
});

test("the prop picks the palette; the default is One Dark Pro; light themes get the theme's colors", () => {
  assert.deepEqual(palette(undefined, theme), PALETTES["one-dark-pro"]);
  assert.deepEqual(palette("dark-plus", theme), PALETTES["dark-plus"]);
  assert.deepEqual(palette("nonsense", theme), PALETTES["one-dark-pro"]);
  assert.deepEqual(palette("theme", theme), themeColors(theme));
  assert.equal(palette("theme", theme).string, "#ansi2");
  const light = { ...theme, foreground: "#1b1b1e", surface: "#ffffff" }, dark = { ...theme, foreground: "#eeeeef", surface: "#17191d" };
  assert.deepEqual(palette("dark-plus", light), themeColors(light), "a light theme: its own colors, readable on its surface");
  assert.deepEqual(palette(undefined, light), themeColors(light));
  assert.deepEqual(palette("dark-plus", dark), PALETTES["dark-plus"]);
  palette("dark-plus", theme).keyword = "changed";
  assert.equal(PALETTES["dark-plus"].keyword, "#569cd6", "a caller can't change the palette");
});

test("a light theme is one whose text is darker than its surface, whatever the system's appearance", () => {
  assert.equal(isLight({ foreground: "#000000", surface: "#c0c0c0", background: "#000000" }), true, "win98: black text on silver (its terminals black)");
  assert.equal(isLight({ foreground: "#1b1b1e", surface: "#ffffff" }), true);
  assert.equal(isLight({ foreground: "#eeeeef", surface: "#17191d" }), false);
  assert.equal(isLight({ foreground: "#eeeeefcc", surface: "#17191d" }), false, "an alpha is left out");
  assert.equal(isLight({}), false, "no colors to tell: dark, as before");
});
