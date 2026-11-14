import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";
const { age, fresh, changedFiles, parseTimes, FRESH } = await mod("ages.js");

const now = Date.UTC(2025, 0, 31, 12, 0, 0);

test("age reads now, minutes, hours, days", () => {
  assert.equal(age(now, now), "now");
  assert.equal(age(now - 59_000, now), "now");
  assert.equal(age(now - 60_000, now), "1m");
  assert.equal(age(now - 3 * 60_000 - 5_000, now), "3m");
  assert.equal(age(now - 59 * 60_000, now), "59m");
  assert.equal(age(now - 2 * 3600_000, now), "2h");
  assert.equal(age(now - 23 * 3600_000 - 59 * 60_000, now), "23h");
  assert.equal(age(now - 5 * 86400_000, now), "5d");
  assert.equal(age(now - 400 * 86400_000, now), "400d");
});

test("a time in the future (clock skew) is now", () => {
  assert.equal(age(now + 3600_000, now), "now");
});

test("fresh is the last ten minutes", () => {
  assert.ok(fresh(now - 1000, now));
  assert.ok(fresh(now - FRESH + 1, now));
  assert.ok(!fresh(now - FRESH, now));
  assert.ok(!fresh(null, now));
  assert.ok(!fresh(undefined, now));
  // settings.freshMinutes: another window, 0 = never.
  assert.ok(fresh(now - 59 * 60000, now, 60 * 60000));
  assert.ok(!fresh(now - 61 * 60000, now, 60 * 60000));
  assert.ok(!fresh(now - 1, now, 0));
});

test("changedFiles: files only, newest first, the untimed last by path", () => {
  const marks = { "a.txt": "M", "dir:src": "A", "src/new.js": "A", "gone.txt": "D", "b.txt": "M", "old.txt": "M" };
  const times = new Map([["a.txt", now - 5000], ["src/new.js", now - 1000], ["old.txt", now - 9e6]]);
  assert.deepEqual(changedFiles(marks, times), [
    { path: "src/new.js", mark: "A", mtime: now - 1000 },
    { path: "a.txt", mark: "M", mtime: now - 5000 },
    { path: "old.txt", mark: "M", mtime: now - 9e6 },
    { path: "b.txt", mark: "M", mtime: null },
    { path: "gone.txt", mark: "D", mtime: null },
  ]);
  assert.deepEqual(changedFiles({}, new Map()), []);
  assert.deepEqual(changedFiles(null, null), []);
});

test("parseTimes reads stat's lines, paths with spaces and tabs too", () => {
  const out = "1762600000\ta.txt\n1762600001\tdir with space/b c.md\n1762600002\tweird\tname\nnot a line\n\n";
  const times = parseTimes(out);
  assert.equal(times.get("a.txt"), 1762600000000);
  assert.equal(times.get("dir with space/b c.md"), 1762600001000);
  assert.equal(times.get("weird\tname"), 1762600002000);
  assert.equal(times.size, 3);
});
