// The stopped bar's Ask an agent… on a narrow panel: an icon button as Ask about diff's there (the
// same icon, no frame), a button to a screen reader named by what it does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { byId, walk, texts, press, load, stubs } from "./render/load.mjs";

const { stoppedBar } = await load("conflictui.js");
const { iconButton } = await import("../../shared/iconbutton.js");
const { asset } = await load("id.js");

// How an element looks: its calls, without the ones naming it or saying what it does, a hover by the
// calls it makes; its icon apart.
function replay(fn) {
  const calls = [];
  const p = new Proxy({}, { get: (_t, m) => (...a) => { calls.push(`${String(m)}(${a.map((x) => JSON.stringify(x)).join(",")})`); return p; } });
  fn(p);
  return calls;
}
const look = (d) => d.calls.filter(([m]) => !["id", "tooltip", "accessibility_label", "child", "children"].includes(m) && !/^on_/.test(m))
  .map(([m, a]) => (m === "hover" ? `hover(${replay(a[0]).join(".")})` : `${m}(${a.map((x) => JSON.stringify(x)).join(",")})`));
const iconOf = (d) => { let p = null; walk({ $: d }, (x) => { if (x.kind === "svg") p ??= [x.path, x.calls]; }); return p; };
const said = (d, m) => d.calls.filter(([k]) => k === m).map(([, a]) => a[0]);

test("under 600 px Ask an agent… is an icon button with the message icon, as Ask about diff; wider, its words", () => {
  const t = stubs.theme();
  let asked = 0;
  const bar = (narrow) => stoppedBar({ t, op: "merge", stopped: {}, conflicts: 2, staged: true, idle: true, busy: null, narrow, version: "2.53.0",
    onContinue() {}, onSkip() {}, onAbort() {}, onAsk: () => { asked += 1; } });
  const ask = byId(bar(true), "conflict-ask");
  const ref = iconButton(t, "ref", asset("message.svg"), () => {}, { tip: "Ask the space's agent about this file's diff", label: "Ask about diff" }).$;
  assert.deepEqual(look(ask), look(ref), "drawn as the icon buttons: no frame, 24 px, radius 6");
  assert.deepEqual(iconOf(ask), iconOf(ref), "the message icon, 14 px");
  assert.deepEqual([said(ask, "role"), said(ask, "accessibility_label"), said(ask, "tooltip")],
    [["button"], ["Ask an agent to resolve them"], ["Ask the space's agent to resolve the conflicts"]]);
  press(ask);
  assert.equal(asked, 1);
  assert.deepEqual(texts({ $: byId(bar(false), "conflict-ask") }), ["Ask an agent…"]);
});
