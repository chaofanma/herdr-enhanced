// onpage.js: a page takes an answer with a timer of its own, so its flow goes on in its own call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";

const { onPage, TICK } = await mod("onpage.js");

// A cx whose timers tick when the test says.
function fakeCx() {
  const timers = [];
  return { timers, timer: { every(ms, fn) { const t = { ms, fn, cancelled: false, cancel() { t.cancelled = true; } }; timers.push(t); return t; } }, tick() { for (const t of timers) if (!t.cancelled) t.fn(); } };
}
const flush = () => new Promise((r) => setImmediate(r));

test("the answer is handed over on the page's own tick, never before; the timer stops then", async () => {
  const cx = fakeCx();
  let give, out = "waiting";
  onPage(cx, new Promise((r) => { give = r; })).then((v) => { out = v; });
  assert.equal(cx.timers.length, 1, "a timer started when it asked");
  assert.equal(cx.timers[0].ms, TICK);
  cx.tick(); await flush();
  assert.equal(out, "waiting", "no answer yet");
  give("worktrees"); await flush();
  assert.equal(out, "waiting", "the answer came in the question's call: it waits for the page's tick");
  cx.tick(); await flush();
  assert.equal(out, "worktrees");
  assert.equal(cx.timers[0].cancelled, true);
});

test("a question that failed hands its error over the same way", async () => {
  const cx = fakeCx();
  let err = null;
  onPage(cx, Promise.reject(new Error("no"))).catch((e) => { err = e; });
  await flush();
  assert.equal(err, null);
  cx.tick(); await flush();
  assert.equal(err?.message, "no");
});
