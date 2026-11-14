// The settings window's pages, the mod's own first: Files settings is Files, Open with, Agents; Git
// settings is Git, Open with, Agents. Run by test/files-enhanced/settings-own-first.test.mjs and
// test/git-enhanced/settings-own-first.test.mjs against each mod's own copy, under its render stubs.
import { test } from "node:test";
import assert from "node:assert/strict";

function* walk(e) { if (!e?.$) return; yield e.$; for (const c of e.$.children) yield* walk(c); }
const textOf = (e) => (typeof e === "string" || typeof e === "number" ? String(e) : e?.$ ? e.$.children.map(textOf).join("") : "");

/** The tests, for one mod: `name` its folder, `stubs` its render stubs, `load(rel)` one of its modules. */
export async function settingsOrderTests({ name, stubs, load }) {
  const { state, makeCx, settle } = stubs;
  const { default: Mod } = await load("main.js");
  const { resetAllWhat } = await load("settingsview.js");
  const { PART } = await load("id.js");
  const own = PART === "files" ? "Files" : "Git", other = PART === "files" ? "Git Enhanced" : "Files Enhanced";

  test(`${name}: the settings window's pages: ${own}, Open with, Agents`, async () => {
    Object.assign(state, { rendering: false, props: { role: "settings", overlay: "o9" } });
    state.execHook = (cmd) => (cmd === "sh" ? { code: 0, stdout: "", stderr: "" } : null);
    const view = new Mod();
    view.init({}, makeCx("async"));
    await settle();
    state.rendering = true;
    let tree;
    try { tree = view.render(makeCx()); } finally { state.rendering = false; }
    const tabs = [...walk(tree)].filter((n) => /^ps-s-/.test(String(n.id)));
    assert.deepEqual(tabs.map((n) => n.id), [`ps-s-${PART}`, "ps-s-open-with", "ps-s-agents"]);
    assert.deepEqual(tabs.map((n) => textOf({ $: n })), [own, "Open with", "Agents"]);
  });

  test(`${name}: Reset all names the pages in the same order`, () => {
    assert.equal(resetAllWhat(false), `Reset all puts ${own}, Open with and Agents back to their defaults.`);
    assert.equal(resetAllWhat(true), `Reset all puts ${own}, Open with and Agents back to their defaults. ${other} uses Open with and Agents too: they change there as well.`);
  });
}
