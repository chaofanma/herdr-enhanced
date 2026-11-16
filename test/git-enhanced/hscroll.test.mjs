import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { BAR, MIN_THUMB, clamp, maxScroll, thumb, dragOffset, pageOffset, wheelDx } = await mod("hscroll.js");

test("clamp and maxScroll", () => {
  assert.equal(clamp(-5, 100), 0);
  assert.equal(clamp(50, 100), 50);
  assert.equal(clamp(150, 100), 100);
  assert.equal(clamp(10, -3), 0, "nothing to scroll");
  assert.equal(maxScroll(1000, 300), 700);
  assert.equal(maxScroll(200, 300), 0);
  assert.equal(maxScroll(300.4, 300), 1);
});

test("thumb: the visible share of the track, where the offset is", () => {
  assert.deepEqual(thumb({ track: 200, visible: 100, total: 400, offset: 0 }), { start: 0, size: 50 });
  assert.deepEqual(thumb({ track: 200, visible: 100, total: 400, offset: 300 }), { start: 150, size: 50 });
  assert.deepEqual(thumb({ track: 200, visible: 100, total: 400, offset: 150 }), { start: 75, size: 50 });
  assert.deepEqual(thumb({ track: 200, visible: 100, total: 400, offset: 999 }), { start: 150, size: 50 }, "clamped");
  assert.equal(thumb({ track: 200, visible: 10, total: 4000, offset: 0 }).size, MIN_THUMB);
  assert.deepEqual(thumb({ track: 200, visible: 300, total: 300, offset: 0 }), { start: 0, size: 200 }, "all fits");
  assert.deepEqual(thumb({ track: 10, visible: 10, total: 4000, offset: 50 }), { start: 0, size: 10 }, "a track shorter than the least thumb");
  assert.ok(BAR > 0);
});

test("dragOffset: the thumb follows the pointer", () => {
  // Track 200, thumb 50: 150 px of travel for 300 px of offset.
  assert.equal(dragOffset({ from: 0, dx: 75, track: 200, size: 50, max: 300 }), 150);
  assert.equal(dragOffset({ from: 150, dx: -75, track: 200, size: 50, max: 300 }), 0);
  assert.equal(dragOffset({ from: 150, dx: 500, track: 200, size: 50, max: 300 }), 300, "clamped");
  assert.equal(dragOffset({ from: 20, dx: 30, track: 50, size: 50, max: 300 }), 20, "no travel");
  // Round trip with thumb(): dragging the thumb by d moves its start by d.
  const t0 = thumb({ track: 300, visible: 120, total: 900, offset: 100 });
  const after = dragOffset({ from: 100, dx: 40, track: 300, size: t0.size, max: 780 });
  assert.ok(Math.abs(thumb({ track: 300, visible: 120, total: 900, offset: after }).start - (t0.start + 40)) < 1e-9);
});

test("pageOffset: a press beside the thumb pages towards it, on it starts a drag", () => {
  const th = { start: 50, size: 40 };
  assert.equal(pageOffset({ x: 60, thumb: th, offset: 100, visible: 120, max: 500 }), null);
  assert.equal(pageOffset({ x: 10, thumb: th, offset: 100, visible: 120, max: 500 }), 0);
  assert.equal(pageOffset({ x: 150, thumb: th, offset: 100, visible: 120, max: 500 }), 220);
  assert.equal(pageOffset({ x: 150, thumb: th, offset: 450, visible: 120, max: 500 }), 500);
});

test("wheelDx: sideways gestures, Shift turns a vertical wheel, vertical ones are the list's", () => {
  assert.equal(wheelDx({ delta: { x: -30, y: 0 }, modifiers: {} }), 30, "a swipe left shows more to the right");
  assert.equal(wheelDx({ delta: { x: 12, y: 2 }, modifiers: {} }), -12);
  assert.equal(wheelDx({ delta: { x: 3, y: -40 }, modifiers: {} }), 0, "mostly vertical: no drift");
  assert.equal(wheelDx({ delta: { x: 0, y: -40 }, modifiers: {} }), 0);
  assert.equal(wheelDx({ delta: { x: 0, y: -40 }, modifiers: { shift: true } }), 40);
  assert.equal(wheelDx({ delta: { x: 0, y: 0 }, modifiers: { shift: true } }), 0);
  assert.equal(wheelDx({}), 0);
});
