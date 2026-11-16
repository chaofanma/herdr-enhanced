// reveal.js's takers (the copies a reveal request can go to: pages, trees) hold them weakly. Herdr
// gives a copy a new object when its mod reloads, without calling the old one's close(), and reveal.js
// stays in memory: a plain Set kept every replaced page alive with all it held (its diff, files,
// commits) until Herdr restarted, and installs (each a reload) filled the memory all mods share
// ("This view could not be re-rendered" with a thrown null). The same file is Files Enhanced's.
import "../shared/no-outer-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("reveal.js: takers lets a replaced page go once nothing else holds it", () => {
  const harness = new URL("./render/load.mjs", import.meta.url).href;
  // A child with --expose-gc: a WeakRef's target stays until the job that made it ends, then a GC.
  const out = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
    const L = await import(${JSON.stringify(harness)});
    const { takers } = await L.load("reveal.js");
    const kept = { n: "kept" };
    (() => { takers.add({ n: "replaced", rows: new Array(100000).fill("row") }); takers.add(kept); })();
    const tick = () => new Promise((r) => setTimeout(r, 0));
    await tick(); globalThis.gc(); await tick(); globalThis.gc();
    console.log(JSON.stringify([...takers].filter((x) => x.n).map((x) => x.n)));
    process.exit(0);
  `], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.deepEqual(JSON.parse(out.trim().split("\n").at(-1)), ["kept"]);
});
