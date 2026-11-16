// Bisect in History: ⋯ → Bisect (the selected commit bad, a tag before it good), the bar's Good and
// Bad until git names the first bad commit, Show it, Reset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, repo, mount, draw, byId, lists, handler, press, texts, settle, makeCx } from "./render/load.mjs";
import { answer } from "./answers.mjs";

test("bisect: started from the selected commit and a tag, marked until the first bad commit, shown, reset", async () => {
  const r = repo(({ write, git }) => {
    for (let i = 1; i <= 8; i++) { write("n.txt", `${i <= 5 ? "ok" : "broken"} ${i}\n`); git("add", "-A"); git("commit", "-qm", `C${i}`); if (i === 1) git("tag", "v1"); }
  });
  const hashes = r.git("rev-list", "HEAD").trim().split("\n"), bad = hashes[0], firstBad = hashes[2];
  const view = await mount(r.dir, { palette: "theme", view: "history" }), h = view.part.history;
  handler(lists(await draw(view)).find((l) => l.listId === "history-commits"), "on_item_click")(bad, makeCx()); await settle();
  press(byId(await draw(view), "history-more"));
  let { spec } = await answer({ pick: "bisect" });
  assert.equal(spec.items.find((i) => i.id === "bisect").label, `Bisect: ${bad.slice(0, 7)} is bad…`);
  ({ spec } = await answer());
  assert.equal(spec.input.value, "v1", "the tag before it");
  ({ spec } = await answer());
  assert.equal(spec.title, "Start bisecting?");
  assert.ok(state.execLog.some(([c, args]) => c === "git" && args.includes("start") && args.includes(r.git("rev-parse", "v1^{commit}").trim())), "started with the hash rev-parse found, not the tag's name");
  assert.ok(h.bisect?.active, h.line);
  for (let n = 0; n < 6 && !h.bisect?.first; n++) {
    const tree = await draw(view), testing = h.bisect.testing;
    assert.match(texts(byId(tree, "bisect-bar"))[0], new RegExp(`^Bisecting · testing ${testing.slice(0, 7)}$`));
    const broken = r.read("n.txt").startsWith("broken");
    press(byId(tree, broken ? "bisect-bad" : "bisect-good")); await settle();
  }
  assert.equal(h.bisect.first, firstBad, h.line);
  let tree = await draw(view);
  assert.equal(texts(byId(tree, "bisect-bar"))[0], `The first bad commit is ${firstBad.slice(0, 7)}`);
  assert.notEqual(r.git("rev-parse", "HEAD").trim(), firstBad);
  assert.ok(h.commits.some((c) => c.hash === firstBad), "the first bad commit is listed, though HEAD (the last tested) is below it");
  press(byId(tree, "bisect-show")); await settle();
  assert.equal(h.selected, firstBad);
  press(byId(await draw(view), "bisect-reset")); await settle();
  assert.equal(h.bisect, null);
  assert.equal(r.git("branch", "--show-current").trim(), "main");
  assert.deepEqual(state.violations, []);
});
