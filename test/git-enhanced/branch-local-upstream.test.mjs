// A branch whose upstream is a local branch (git branch --track feat main): git's %(upstream) is
// refs/heads/main there. Its rows and questions said "refs/heads/main", called it a remote branch that
// stays ("Its remote branch refs/heads/main stays"), and History's label menu offered "Push to
// refs/heads/main", which published it to the remote (git push -u origin feat) and so replaced its
// upstream without a word. Now it is "main" (localUpstream), never a remote branch, and that Push is
// "Publish to origin…", asked first: it then tracks origin/feat instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { state, mount, draw, byId, texts, settle, makeCx, load } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";
import { answer } from "./answers.mjs";

const B = await load("branches.js"), Refs = await load("refs.js"), WB = await load("wtbranch.js");
const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const cfg = (d) => { for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["core.hooksPath", "/dev/null"]]) sh(d, "config", k, v); };
const commit = (d, file, text, msg) => { writeFileSync(join(d, file), text); sh(d, "add", "-A"); sh(d, "commit", "-qm", msg); };

// lantern (main, pushed) with feat tracking the local main, one commit ahead of it.
function repo() {
  const base = realpathSync(tempDir("git-enhanced-local-up-")), A = join(base, "lantern"), R = join(base, "origin.git");
  sh(base, "init", "-q", "--bare", "-b", "main", "origin.git");
  sh(base, "clone", "-q", "origin.git", "lantern"); cfg(A);
  commit(A, "f.txt", "one\n", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  sh(A, "branch", "--track", "feat", "main");
  sh(A, "switch", "-q", "feat"); commit(A, "g.txt", "g\n", "Feat work"); sh(A, "switch", "-q", "main");
  return { A, R };
}

test("branches: a local branch as the upstream is short, marked, and never a remote branch", () => {
  const out = ["refs/heads/feat\x1f2 days ago\x1f \x1frefs/heads/main\x1f", "refs/heads/main\x1f1 day ago\x1f*\x1frefs/remotes/origin/main\x1f",
    "refs/remotes/origin/main\x1f1 day ago\x1f \x1f\x1f", "refs/remotes/origin/feat\x1f3 days ago\x1f \x1f\x1f"].join("\n");
  const { local, remote } = B.parseBranchRefs(out, ["origin"]);
  assert.deepEqual(local, [{ name: "feat", age: "2 days ago", current: false, upstream: "main", localUpstream: true },
    { name: "main", age: "1 day ago", current: true, upstream: "origin/main" }]);
  const [feat, main] = local;
  assert.deepEqual([B.remoteUpstream(feat), B.remoteUpstream(main)], [null, "origin/main"]);
  assert.deepEqual([B.upstreamRef(feat), B.upstreamRef(main), B.upstreamRef({ name: "x", upstream: null })], ["refs/heads/main", "refs/remotes/origin/main", null]);
  // origin/feat: no local branch tracks it (feat tracks main): the local branch of its name.
  assert.deepEqual(B.remoteTarget(remote.find((r) => r.name === "origin/feat"), local), { local: "feat" });
  assert.equal(B.renameQuestion(feat, "feat").detail, "It keeps tracking main.");
  assert.equal(B.renameQuestion(main, "main").detail, "It keeps tracking origin/main; the remote branch keeps its name.");
  assert.doesNotMatch(B.deleteQuestion(feat).detail, /remote branch/);
  assert.match(B.deleteQuestion(main).detail, /Its remote branch origin\/main stays\.$/);
  assert.equal(Refs.upstreamQuestion(feat, ["origin/main", "origin/feat"]).choices.value, "origin/main");
  assert.doesNotMatch(WB.removeAndDeleteAsk(feat, { path: "/r/wt" }, "~/wt").detail, /remote branch/);
  const items = Refs.refItems({ kind: "branch", name: "feat" }, { b: feat, current: "main", remote: "origin" });
  assert.deepEqual(items.find((x) => x.id === "push"), { id: "push", label: "Publish to origin…", disabled: false, detail: "It then tracks origin/feat, not main" });
});

test("changes and history: such a branch says main, and History's Publish to origin… asks, then it tracks origin/feat", async () => {
  const { A, R } = repo();
  // The Changes picker: "main ↑1" on its second line.
  const changes = await mount(A), page = changes.part;
  page.openBranches(true, makeCx()); await settle();
  const words = texts(byId(await draw(changes), `branch-${page.branches.findIndex((b) => b.name === "feat")}`));
  assert.ok(words.some((x) => / · main ↑1$/.test(x)), words.join(" | "));
  assert.ok(!words.some((x) => x.includes("refs/heads")));
  // History's label menu on feat.
  const view = await mount(A, { palette: "theme", view: "history" }), h = view.part.history;
  h.refMenu({ kind: "branch", name: "feat", current: false }, makeCx()); await settle();
  const menu = state.overlays.at(-1).props.question;
  assert.equal(menu.items.find((x) => x.id === "push").label, "Publish to origin…");
  await answer({ pick: "push" });
  // Cancelled: nothing pushed, still tracking main.
  let { spec } = await answer({ cancel: true });
  assert.equal(spec.title, "Publish feat to origin?");
  assert.equal(spec.detail, "git push -u origin feat: feat then tracks origin/feat instead of main.");
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "feat@{u}").trim(), "main");
  h.refMenu({ kind: "branch", name: "feat", current: false }, makeCx()); await settle();
  await answer({ pick: "push" });
  ({ spec } = await answer());
  await settle();
  assert.equal(sh(R, "rev-parse", "--verify", "-q", "refs/heads/feat").trim(), sh(A, "rev-parse", "feat").trim(), "published");
  assert.equal(sh(A, "rev-parse", "--abbrev-ref", "feat@{u}").trim(), "origin/feat");
  assert.deepEqual(state.violations, []);
});
