// Files Enhanced asks the space's agent in a send dialog of its own (shared/send.js), so it works
// without Git Enhanced installed (the stubs' app folder has no other mod).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { state, stubs, load, makeCx, settle, folder, at, draw, byId, text } from "./render/load.mjs";
import { NAME } from "./mod.mjs";

const { default: Files } = await load("main.js");
const { items } = await load("menu.js");

test("Ask agent about this…: Files' own send dialog, sent with hc send or started as the settings' agent", async () => {
  assert.equal(existsSync(join(stubs.appHome(), "mods", "git-enhanced", "main.js")), false, "Git Enhanced isn't installed");
  const dir = folder(["a.txt"]);
  at(dir);
  state.overlays.length = 0; state.runs.length = 0; state.hcLog.length = 0; state.notes.length = 0; state.agents = [];
  items({ root: dir, on: null, rel: "a.txt", dir: false, found: null }).find((x) => x?.label === "Ask agent about this…").run();
  const spec = state.overlays.at(-1);
  assert.deepEqual([spec.mod, spec.kind, spec.props.role, spec.props.send.title, spec.props.send.context], [NAME, "dialog", "send", "a.txt", `File: ${join(dir, "a.txt")}`]);
  // The dialog: a copy of this mod.
  const open = () => { state.props = { ...spec.props, overlay: "o7" }; const v = new Files(); v.init({}, makeCx()); return v; };
  let view = open();
  let root = draw(view);
  assert.match(text(root), /No agent is running in this space\. Send starts pi in a new tab/);
  assert.equal(text(byId(root, "send-go")), "Start pi");
  view.role.send(makeCx());
  assert.deepEqual(state.runs.at(-1), ["tab.new", { space: "s1", argv: ["pi"], task: `File: ${join(dir, "a.txt")}` }]);
  // An agent in the space: the note and the paths go to it; a busy one asks once more.
  state.agents = [{ address: "t9", space: "s1", status: "working", focused: false, program: { name: "pi" }, tab_name: "1" }];
  view = open();
  view.role.note.set_value("What is this file for?");
  view.role.send(makeCx());
  assert.equal(text(byId(draw(view), "send-go")), "Send anyway");
  assert.deepEqual(state.hcLog, [], "not yet");
  view.role.send(makeCx());
  await settle();
  assert.deepEqual(state.hcLog.at(-1), ["send", "--force", "t9", `What is this file for?\n\nFile: ${join(dir, "a.txt")}`]);
  assert.deepEqual(state.runs.at(-1), ["agent.focus", { terminal: "t9" }]);
  assert.deepEqual(state.closed.slice(-1), ["o7"]);
  state.agents = []; state.props = {};
  assert.deepEqual(state.violations, []);
});
