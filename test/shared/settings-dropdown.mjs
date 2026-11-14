// The settings window's drop-downs float: the list opens under its field over the rows below (a
// Popover, as History's filters), so neither the field nor anything else moves when it opens or
// closes. Run by test/files-enhanced/settings-dropdown.test.mjs and
// test/git-enhanced/settings-dropdown.test.mjs against each mod's own copy, under its render stubs.
import { test } from "node:test";
import assert from "node:assert/strict";

function* walk(e) { if (!e?.$) return; yield e.$; for (const c of e.$.children) yield* walk(c); }
const textOf = (e) => (typeof e === "string" || typeof e === "number" ? String(e) : e?.$ ? e.$.children.map(textOf).join("") : "");
const byId = (root, id) => [...walk(root)].find((n) => n.id === id) ?? null;
const popover = (root, id) => [...walk(root)].find((n) => n.kind === "popover" && n.popover === id) ?? null;
// The row a node is in: the nearest h_flex holding it that lines its children up (items_center or items_start).
function rowOf(root, node) {
  const path = [];
  const find = (e) => { if (!e?.$) return false; path.push(e.$); if (e.$ === node) return true; for (const c of e.$.children) if (find(c)) return true; path.pop(); return false; };
  find(root);
  return path.reverse().find((n) => n.calls.some(([m]) => m === "items_center" || m === "items_start")) ?? null;
}
const lined = (n) => n.calls.filter(([m]) => m === "items_center" || m === "items_start").map(([m]) => m);

/** The tests, for one mod: `name` its folder, `stubs` its render stubs, `load(rel)` one of its modules. */
export async function settingsDropdownTests({ name, stubs, load }) {
  const { state, makeCx, settle } = stubs;
  const { default: Mod } = await load("main.js");
  const { PART } = await load("id.js");

  const mount = async (section) => {
    Object.assign(state, { rendering: false, props: { role: "settings", overlay: "o9", section } });
    state.execHook = (cmd) => (cmd === "sh" ? { code: 0, stdout: "cli zed\ncli nvim\ncli code\ncli pi\n", stderr: "" } : null);
    const view = new Mod();
    view.init({}, makeCx("async"));
    await settle();
    return view;
  };
  const draw = (view) => { state.rendering = true; try { return view.render(makeCx()); } finally { state.rendering = false; } };

  const drops = [["open-with", "ps-pick-double"], ["open-with", "ps-pick-open"], ["open-with", "ps-pick-line"], ...(PART === "changes" ? [["changes", "ps-commitAgent"]] : [])];
  for (const [section, id] of drops) {
    test(`${name}: ${id}: its list floats under the field; nothing moves when it opens or closes`, async () => {
      const view = await mount(section);
      let root = draw(view);
      // Closed: the field is a Popover's trigger, and the Popover opens it (the field has no click of its own).
      let pop = popover(root, `${id}-drop`);
      assert.ok(pop, "a Popover");
      assert.equal(pop.triggerEl?.$?.id, `${id}-field`, "the field is its trigger");
      assert.equal(pop.contentEl, undefined, "closed: no list");
      assert.equal(byId(root, `${id}-field`).handlers.on_click, undefined, "the Popover takes the press");
      assert.deepEqual(lined(rowOf(root, pop)), ["items_center"], "closed: the row is centred");
      // Opened (a press on the field): the list is the Popover's content, the row still centred.
      pop.handlers.on_open_change[0].at(-1)(true, makeCx());
      root = draw(view);
      pop = popover(root, `${id}-drop`);
      assert.ok(pop.calls.some(([m, a]) => m === "open" && a[0] === true), "open");
      assert.ok(byId(root, `${id}-0`), "its choices");
      assert.ok([...walk(pop.contentEl)].some((n) => n.id === `${id}-0`), "in the Popover's content, over the rows below");
      assert.deepEqual(lined(rowOf(root, pop)), ["items_center"], "open: the row is still centred, so the field stays put");
      // A press outside it (the Popover's dismissal): closed again.
      pop.handlers.on_open_change[0].at(-1)(false, makeCx());
      root = draw(view);
      assert.equal(byId(root, `${id}-0`), null, "closed");
      // A pick closes it too.
      popover(root, `${id}-drop`).handlers.on_open_change[0].at(-1)(true, makeCx());
      root = draw(view);
      const second = byId(root, `${id}-1`);
      second.handlers.on_click.at(-1).at(-1)({ click_count: 1, modifiers: {} }, makeCx());
      root = draw(view);
      assert.equal(byId(root, `${id}-0`), null, "a pick closes it");
      assert.ok(textOf({ $: byId(root, `${id}-field`) }).length > 0);
    });
  }
}
