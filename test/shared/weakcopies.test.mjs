// weakCopies (shared/weakcopies.js): the set reveal.js keeps a mod's copies in. Herdr replaces a copy's
// object on a reload without closing it, and the module holding the set stays: a plain Set kept every
// replaced copy alive. Members come and go like a Set's; one that nothing else holds is let go.
import "./no-outer-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { weakCopies } from "../../shared/weakcopies.js";

test("weakCopies: add once, in order; delete, has, clear, size", () => {
  const s = weakCopies(), a = { n: "a" }, b = { n: "b" }, c = { n: "c" };
  s.add(a).add(b).add(a).add(c);
  assert.deepEqual([...s], [a, b, c], "added again: keeps its place");
  assert.equal(s.size, 3);
  assert.equal(s.has(b), true);
  assert.equal(s.delete(b), true);
  assert.equal(s.delete(b), false);
  assert.equal(s.has(b), false);
  assert.deepEqual([...s], [a, c]);
  s.clear();
  assert.deepEqual([...s], []);
  assert.equal(s.size, 0);
});

test("weakCopies: a member nothing else holds is let go", () => {
  // A child with --expose-gc: a WeakRef's target stays until the job that made it ends, then a GC.
  const url = new URL("../../shared/weakcopies.js", import.meta.url).href;
  const out = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
    const { weakCopies } = await import(${JSON.stringify(url)});
    const s = weakCopies(), kept = { n: "kept" };
    (() => { s.add({ n: "dropped", data: new Array(100000).fill(1) }); s.add(kept); })();
    const tick = () => new Promise((r) => setTimeout(r, 0));
    await tick(); globalThis.gc(); await tick(); globalThis.gc();
    console.log(JSON.stringify([...s].map((x) => x.n)));
  `], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), ["kept"]);
});
