// The font the diffs and code are drawn in: the terminals' font, as settings() gives it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, load } from "./render/load.mjs";

const { codeFont } = await load("codefont.js");

test("the code font is the terminals' (settings().font_family, as Herdr's own Changes and Files read it); JetBrains Mono without one", () => {
  try {
    state.settings = { font_family: "Geist Mono" };
    assert.equal(codeFont(), "Geist Mono");
    state.settings = {};
    assert.equal(codeFont(), "JetBrains Mono");
  } finally { state.settings = undefined; }
});

test("the code size: 12 by default; the settings' Code size (11 to 14, or the terminals' size less one); a block's font_size wins", async () => {
  const { codeSize } = await load("codefont.js");
  const KEY = "git-enhanced.settings";
  try {
    state.shared.delete(KEY); state.props = {};
    assert.equal(codeSize(), 12, "the default, as Files' preview");
    for (const n of [11, 13, 14]) { state.shared.set(KEY, { codeSize: n }); assert.equal(codeSize(), n); }
    state.shared.set(KEY, { codeSize: "terminal" });
    state.settings = { font_size: 16 };
    assert.equal(codeSize(), 15, "the terminals' size less one");
    state.settings = { font_size: 8 };
    assert.equal(codeSize(), 9, "9 at least");
    state.shared.set(KEY, { codeSize: 99 });
    assert.equal(codeSize(), 12, "a value the settings don't offer is the default");
    state.props = { font_size: 10 };
    assert.equal(codeSize(), 10, "the block's own size");
  } finally { state.shared.delete(KEY); state.props = {}; state.settings = undefined; }
});
