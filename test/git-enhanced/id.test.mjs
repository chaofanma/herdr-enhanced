import { test } from "node:test";
import assert from "node:assert/strict";
import { mod, NAME } from "./mod.mjs";

const { ID, asset, own, KEY, REFS, UNDO_MARK, CACHE } = await mod("id.js");

test("the mod's name comes from its folder, and every key, ref and asset from the name", () => {
  assert.equal(ID, NAME);
  assert.equal(asset("check.svg"), `mods/${NAME}/check.svg`);
  assert.equal(own("lines"), `${NAME}.lines`);
  for (const [field, key] of Object.entries(KEY)) assert.equal(key, `${NAME}.${field}`, field);
  assert.equal(REFS, `refs/${NAME}/`);
  assert.equal(UNDO_MARK, `[${NAME} undo]`);
  assert.equal(CACHE, `cache/${NAME}`);
});

test("tabs.js's keys, derived from the mod's name (herdr-t3's t3-pane reads \"<mod>.titles\"), are the ones listed here", async () => {
  const { keysOf } = await mod("tabplace.js");
  assert.deepEqual(keysOf(ID), { tabs: KEY.tabs, titles: KEY.titles });
});
