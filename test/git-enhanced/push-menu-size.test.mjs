// The ▾ beside Push as the commit bar's other buttons: 26 px tall, radius 6 (it stayed 32 px, radius
// 8, when the bar became the size of Herdr's tab bar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mount, draw, byId } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const sh = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const call = (d, m) => d.calls.find(([k]) => k === m)?.[1];

test("▾ by Push is as tall as Push, with its radius", async () => {
  const base = tempDir("git-enhanced-pushmenu-");
  sh(base, "init", "-q", "--bare", "-b", "main", "remote.git");
  sh(base, "clone", "-q", "remote.git", "a"); const A = join(base, "a");
  sh(A, "config", "user.name", "t"); sh(A, "config", "user.email", "t@t"); sh(A, "config", "core.hooksPath", "/dev/null");
  writeFileSync(join(A, "f.txt"), "one\n"); sh(A, "add", "-A"); sh(A, "commit", "-qm", "First"); sh(A, "push", "-q", "-u", "origin", "HEAD:main");
  const tree = await draw(await mount(A, { palette: "theme" }));
  const menu = byId(tree, "push-menu"), push = byId(tree, "push");
  assert.ok(menu && push);
  assert.deepEqual([call(menu, "h"), call(menu, "rounded")], [call(push, "h"), call(push, "rounded")]);
  assert.deepEqual(call(menu, "h"), [26]);
});
