import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { enterAction, Presses, newlineTyped } = await mod("keys.js");

test("enterAction: cmd-enter commits, plain Enter is the textarea's", () => {
  assert.equal(enterAction({ secondary: true, typing: true }), "commit");
  assert.equal(enterAction({ secondary: true }), "commit", "the panel has the keyboard");
  assert.equal(enterAction({ typing: true }), null, "a newline");
  assert.equal(enterAction({ shift: true, typing: true }), null);
  assert.equal(enterAction({}), null);
  assert.equal(enterAction(), null);
  assert.equal(enterAction({ control: true, typing: true }), null, "ctrl-enter does not commit");
  assert.equal(enterAction({ control: true }), null);
});

test("enterAction: the comment box keeps cmd- and ctrl-enter unless the message box has the keyboard", () => {
  assert.equal(enterAction({ secondary: true, composer: true }), "comment");
  assert.equal(enterAction({ control: true, composer: true }), "comment");
  assert.equal(enterAction({ composer: true }), null, "plain Enter: the comment box's own submit adds");
  assert.equal(enterAction({ secondary: true, composer: true, typing: true }), "commit");
});

test("enterAction: never while naming a branch or on a held key's repeat", () => {
  assert.equal(enterAction({ secondary: true, naming: true }), null);
  assert.equal(enterAction({ secondary: true, naming: true, composer: true }), null);
  assert.equal(enterAction({ secondary: true, held: true, typing: true }), null);
  assert.equal(enterAction({ control: true, held: true, composer: true }), null);
});

test("Presses: one press reaching the panel twice acts once, in either order", () => {
  const p = new Presses(150, 2000);
  assert.equal(p.take(1000), true);
  assert.equal(p.take(1001), false, "the same press by the other path");
  p.release();
  assert.equal(p.take(1400), true, "the next press");
  p.release();
  assert.equal(p.take(1450), false, "the key went up before the other path's delivery: still within 150 ms");
});

test("Presses: a held key's repeats count once until the key goes up", () => {
  const p = new Presses(150, 2000);
  assert.equal(p.take(0), true);
  for (let t = 225; t <= 3000; t += 30) assert.equal(p.take(t), false, `repeat at ${t}`);
  p.release();
  assert.equal(p.take(3200), true, "a new press");
});

test("Presses: no key-up, no new press, unless 2 s pass without a delivery", () => {
  const p = new Presses(150, 2000);
  assert.equal(p.take(0), true);
  assert.equal(p.take(600), false, "the key-up was not seen");
  assert.equal(p.take(2700), true, "2 s since the last delivery: a missed key-up");
});

test("newlineTyped: one newline typed at the cursor, or over the selection", () => {
  assert.equal(newlineTyped("ab", "a\nb"), true, "middle");
  assert.equal(newlineTyped("ab", "ab\n"), true, "end");
  assert.equal(newlineTyped("ab", "\nab"), true, "start");
  assert.equal(newlineTyped("", "\n"), true, "empty box");
  assert.equal(newlineTyped("a\n", "a\n\n"), true, "after a newline");
  assert.equal(newlineTyped("\nx", "\n\nx"), true, "beside one");
  assert.equal(newlineTyped("a\nb", "a\n\nb"), true);
  assert.equal(newlineTyped("abc", "a\nc"), true, "over a selection");
  assert.equal(newlineTyped("Fix the bug", "Fix\nbug"), true, "over a longer selection");
  assert.equal(newlineTyped("ab", "ab"), false, "nothing typed");
  assert.equal(newlineTyped("ab", "a\n\nb"), false, "two newlines");
  assert.equal(newlineTyped("ab", "axb"), false, "a letter");
  assert.equal(newlineTyped("a\nb", "ab"), false, "a newline removed is not one typed");
  assert.equal(newlineTyped("ab", "a\nbc"), false, "and something else");
});
