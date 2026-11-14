// The machine layer (machine.js): its sh scripts run for real, on this computer ("here") and as if on
// another machine ("sim": the stubs run every exec here, so the remote code paths run against local
// folders), under the system's sh and under dash (what Linux machines run as sh), with BSD tools and
// with GNU ones where they're installed (gstat, gbase64: shims on PATH).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, symlinkSync, chmodSync, statSync, lstatSync, readdirSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { state, load, folder, settle, stubs } from "./render/load.mjs";
import { tempDir } from "./tmp.mjs";

const M = await load("machine.js");

const which = c => { const r = spawnSync("sh", ["-c", `command -v ${c}`], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
// A folder of links to programs, for a PATH that has only those (and the GNU ones under their names).
function shims(names, gnu = {}) {
  const d = tempDir("files-enhanced-bin-");
  for (const n of names) { const p = which(n); if (p) symlinkSync(p, join(d, n)); }
  for (const [n, g] of Object.entries(gnu)) { const p = which(g); if (p) symlinkSync(p, join(d, n)); }
  return d;
}
const BASIC = ["sh", "dirname", "basename", "mktemp", "wc", "tr", "cksum", "stat", "chmod", "mv", "cat", "rm", "mkdir", "cp", "ls", "tail", "touch", "head", "sleep", "kill", "find", "uname", "getconf", "pwd", "sort"];
const dash = existsSync("/bin/dash") ? "/bin/dash" : which("dash");
const gnu = which("gstat") && which("gbase64");
// The shells and tool sets the scripts run with.
const VARIANTS = [
  { name: "sh", sh: null, path: null },
  ...(dash ? [{ name: "dash", sh: dash, path: null }] : []),
  ...(dash && gnu ? [{ name: "dash with GNU stat and base64", sh: dash, path: `${shims(BASIC.filter(n => n !== "stat"), { stat: "gstat", base64: "gbase64" })}` }] : []),
];
const use = v => { state.sh = v.sh; state.path = v.path; M.forget(); };
const reset = () => use(VARIANTS[0]);

test("cksum is POSIX cksum's CRC, and expectOf what WRITE compares", () => {
  for (const text of ["", "a", "hello\n", "한국어 ✓\r\n", "x".repeat(70000)]) {
    const r = spawnSync("cksum", { input: Buffer.from(text, "utf8"), encoding: "utf8" });
    const [crc, size] = r.stdout.trim().split(/\s+/);
    assert.equal(M.expectOf(text), `${crc} ${size}`, JSON.stringify(text.slice(0, 20)));
  }
  const bytes = randomBytes(200000), r = spawnSync("cksum", { input: bytes, encoding: "utf8" });
  assert.equal(String(M.cksum(bytes)), r.stdout.trim().split(/\s+/)[0]);
});

test("chunks and caps: base64 in pieces under 128 KiB, what fits the machine's ARG_MAX", () => {
  const b64 = randomBytes(300000).toString("base64"), parts = M.chunks(b64);
  assert.ok(M.CHUNK % 4 === 0 && M.CHUNK < 131072);
  assert.ok(parts.length === Math.ceil(b64.length / M.CHUNK) && parts.every(p => p.length <= M.CHUNK && p.length % 4 === 0));
  assert.equal(parts.join(""), b64);
  assert.deepEqual(M.chunks(""), []);
  assert.equal(M.writeCap(1048576), 737280, "macOS: 1 MiB of arguments");
  assert.equal(M.writeCap(2097152), M.REMOTE_WRITE, "Linux: 2 MiB, capped at 1 MiB");
  assert.equal(M.writeCap(0), M.REMOTE_WRITE, "unknown: the cap");
});

for (const v of VARIANTS) {
  test(`LIST (${v.name}): entries, links to folders, .git left out, limits, errors, chains`, async () => {
    use(v);
    const d = folder(["a.txt", ".env", "src/x.js", "src/main/java/App.java", "lib/one/two/f.txt", "empty/", "dir with space/b c.md", "repo/.git/HEAD", "repo/r.txt", "한국/새.md"]);
    writeFileSync(join(d, "new\nline.txt"), "");
    symlinkSync(join(d, "src"), join(d, "srclink"));
    for (const on of [null, "sim"]) {
      const got = await M.listFolders(on, [d, join(d, "repo"), join(d, "nope"), join(d, "a.txt")], { chains: true });
      const top = got.get(d);
      assert.deepEqual(top.entries.map(e => `${e.dir ? "d" : "f"}:${e.name}`).sort(),
        ["d:dir with space", "d:empty", "d:lib", "d:repo", "d:src", "d:srclink", "d:한국", "f:.env", "f:a.txt", "f:new\nline.txt"]);
      assert.equal(top.more, false); assert.equal(top.error, null);
      assert.deepEqual(got.get(join(d, "repo")).entries, [{ name: "r.txt", dir: false }], ".git is never listed");
      assert.equal(got.get(join(d, "nope")).error, "No such folder");
      assert.equal(got.get(join(d, "a.txt")).error, "No such folder");
      // Chains: what each folder on the way holds, for Compact folders to decide.
      const steps = top.steps, kids = p => steps.get(p)?.map(k => `${k.git ? "g" : k.dir ? "d" : "f"}:${k.name}`).sort();
      assert.deepEqual(kids("lib"), ["d:one"]); assert.deepEqual(kids("lib/one"), ["d:two"]); assert.deepEqual(kids("lib/one/two"), ["f:f.txt"]);
      assert.deepEqual(kids("src"), ["d:main", "f:x.js"]); assert.deepEqual(kids("src/main"), ["d:java"]);
      assert.deepEqual(kids("repo"), ["f:r.txt", "g:.git"]); assert.equal(steps.has("repo/.git"), false, "a repository ends a chain");
      assert.deepEqual(kids("empty"), []);
      assert.deepEqual(kids("srclink"), ["d:main", "f:x.js"]);
      const few = (await M.listFolders(on, [d], { limit: 3 })).get(d);
      assert.equal(few.entries.length, 3); assert.equal(few.more, true);
    }
    assert.deepEqual(await M.listFolder("sim", join(d, "src")), (await M.listFolder(null, join(d, "src"))));
    await assert.rejects(M.listFolder("sim", join(d, "nope")), /No such folder/);
    reset();
  });

  test(`WRITE on another machine (${v.name}): new file, over it, changed on disk, its mode, a link, many pieces`, async () => {
    use(v); state.writes.length = 0; state.execLog.length = 0;
    const d = folder([]), f = join(d, "notes.txt");
    await M.writeText("sim", f, "one\n", null);
    assert.equal(readFileSync(f, "utf8"), "one\n");
    assert.equal(statSync(f).mode & 0o777, 0o666 & ~process.umask(), "a new file gets the umask's mode");
    await assert.rejects(M.writeText("sim", f, "x", null), e => e.stale && /already exists/.test(e.message));
    await M.writeText("sim", f, "two\n", "one\n");
    assert.equal(readFileSync(f, "utf8"), "two\n");
    await assert.rejects(M.writeText("sim", f, "three\n", "one\n"), e => e.stale && /changed on disk/.test(e.message));
    assert.equal(readFileSync(f, "utf8"), "two\n", "a stale save leaves the file alone");
    chmodSync(f, 0o751);
    await M.writeText("sim", f, "four\n", "two\n");
    assert.equal(statSync(f).mode & 0o777, 0o751, "the file keeps its mode");
    const link = join(d, "link.txt");
    symlinkSync(f, link);
    await M.writeText("sim", link, "five\n", "four\n");
    assert.ok(lstatSync(link).isSymbolicLink(), "a link stays a link");
    assert.equal(readFileSync(f, "utf8"), "five\n");
    const big = "한국어 é\r\n".repeat(25000) + "\0end";
    await M.writeText("sim", f, big, "five\n");
    assert.equal(readFileSync(f, "utf8"), big);
    const args = state.execLog.at(-1)[1].slice(6);
    assert.ok(args.length >= 4 && args.every(a => a.length <= M.CHUNK), `${args.length} pieces`);
    assert.deepEqual(readdirSync(d).sort(), ["link.txt", "notes.txt"], "no temp files left");
    assert.deepEqual(state.writes, [], "Herdr's writeTextFile is for this computer only");
    await M.writeText(null, f, "here\n", big);
    assert.deepEqual(state.writes, [f]);
    reset();
  });

  test(`INFO, times and the change scripts (${v.name})`, async () => {
    use(v);
    const d = folder(["a.txt", "sub/b.txt"]), t = Math.floor(Date.now() / 1000) - 500;
    utimesSync(join(d, "a.txt"), t, t);
    const [a, sub, gone] = await M.info("sim", [join(d, "a.txt"), join(d, "sub"), join(d, "gone")]);
    assert.deepEqual(a, { kind: "f", mtime: t * 1000, size: 5 });
    assert.equal(sub.kind, "d"); assert.deepEqual(gone, { kind: "x", mtime: 0, size: 0 });
    assert.equal((await M.times("sim", d, ["a.txt", "nope"])).get("a.txt"), t * 1000);
    assert.equal((await M.mtimes("sim", d, ["sub/b.txt"])).size, 1);
    await M.makeEntry("sim", join(d, "x/y/new.txt"), false);
    assert.equal(readFileSync(join(d, "x/y/new.txt"), "utf8"), "");
    await assert.rejects(M.makeEntry("sim", join(d, "x/y/new.txt"), false), /new\.txt already exists/);
    await M.makeEntry("sim", join(d, "folder"), true);
    assert.ok(statSync(join(d, "folder")).isDirectory());
    await assert.rejects(M.renameEntry("sim", join(d, "a.txt"), "folder"), /folder already exists/);
    await M.renameEntry("sim", join(d, "a.txt"), "A.txt");
    assert.ok(readdirSync(d).includes("A.txt") && !readdirSync(d).includes("a.txt"), "a change of case only");
    assert.equal(await M.gone("sim", join(d, "folder")), false);
    assert.equal(await M.gone("sim", join(d, "nothing")), true);
    reset();
  });
}

test("Delete on another machine: to its Trash when it has one, else for good", async () => {
  state.sh = null; state.path = shims(BASIC); M.forget();
  const d = folder(["a.txt", "dir/b.txt"]);
  assert.equal(M.capsOf("sim", await M.facts("sim")).trash, null, "no gio, trash-put or trash there");
  await M.trashEntry("sim", join(d, "dir"));
  assert.equal(existsSync(join(d, "dir")), false);
  await assert.rejects(M.trashEntry("sim", join(d, "dir")), /already gone/);
  // The scripts themselves for each way (gio and the rest can't be tried here).
  const r = spawnSync("sh", ["-c", M.TRASH, "sh", "rm", join(d, "a.txt")], { encoding: "utf8" });
  assert.equal(r.status, 0); assert.equal(existsSync(join(d, "a.txt")), false);
  reset();
});

test("WRITE: cut short, nothing to decode with, too big for the machine", async () => {
  const d = folder(["f.txt"]), f = join(d, "f.txt");
  let r = spawnSync("sh", ["-c", M.WRITE, "sh", f, M.expectOf("f.txt"), "9", Buffer.from("abc").toString("base64")], { encoding: "utf8" });
  assert.equal(r.status, 1); assert.match(r.stderr, /cut short/);
  r = spawnSync("sh", ["-c", M.WRITE, "sh", f, M.expectOf("f.txt"), "3", "YWJj"], { encoding: "utf8", env: { PATH: shims(BASIC) } });
  assert.equal(r.status, 5); assert.match(r.stderr, /needs base64 or openssl/);
  assert.equal(readFileSync(f, "utf8"), "f.txt");
  if (which("openssl")) {
    r = spawnSync("sh", ["-c", M.WRITE, "sh", f, M.expectOf("f.txt"), "3", "YWJj"], { encoding: "utf8", env: { PATH: shims([...BASIC, "openssl"]) } });
    assert.equal(r.status, 0, r.stderr); assert.equal(readFileSync(f, "utf8"), "abc", "openssl decodes where there's no base64");
    writeFileSync(f, "f.txt");
  }
  reset();
  const caps = M.capsOf("sim", await M.facts("sim"));
  assert.equal(caps.writeMax, M.writeCap(Number(spawnSync("getconf", ["ARG_MAX"], { encoding: "utf8" }).stdout)));
  const over = "x".repeat(caps.writeMax + 1);
  await assert.rejects(M.writeText("sim", f, over, "f.txt"), /Too big to save on sim .*takes up to/);
  // Just under: several hundred KB in pieces, within this Mac's ARG_MAX.
  const near = "y".repeat(Math.min(caps.writeMax, 600000));
  await M.writeText("sim", f, near, "f.txt");
  assert.equal(readFileSync(f, "utf8"), near);
});

test("facts: what a machine has; a machine without sh (Windows) has no sh features", async () => {
  assert.deepEqual(M.parseFacts("Linux\n2097152\ngit\nrg\n"), { os: "Linux", argMax: 2097152, tools: new Set(["git", "rg"]), sh: true });
  M.forget();
  state.execHook = (c, _a, _cwd, on) => (on === "win" && c === "sh" ? Promise.reject(new Error("cannot start sh: program not found")) : null);
  const f = await M.facts("win");
  assert.equal(f.sh, false);
  assert.deepEqual([M.capsOf("win").shell, M.capsOf("win").write, M.capsOf("win").zip, M.capsOf("win").trash], [false, false, false, null]);
  state.execHook = null; M.forget();
  const here = M.capsOf(null, await M.facts(null));
  assert.equal(here.shell, true); assert.equal(here.trash, "finder"); assert.equal(here.write, true);
});

test("images: copied here into the app's cache, fetched from another machine as base64", async () => {
  reset();
  const d = folder([]), f = join(d, "pic.png"), bytes = randomBytes(5000);
  writeFileSync(f, bytes);
  const here = await M.imageFor(null, f), there = await M.imageFor("sim", f);
  for (const p of [here, there]) {
    assert.match(p, /^cache\/[a-z0-9-]+\/[0-9a-f]{16}\.png$/);
    assert.deepEqual(readFileSync(join(stubs.appHome(), p)), bytes);
  }
  assert.notEqual(here, there, "the machine is part of the name");
  assert.equal(await M.imageFor("sim", f), there, "fetched once, then from the cache");
  const huge = join(d, "huge.png");
  writeFileSync(huge, Buffer.alloc(M.REMOTE_IMAGE + 10));
  await assert.rejects(M.imageFor("sim", huge), /Too large to preview \(5 MB\)/);
  await assert.rejects(M.imageFor("sim", join(d, "none.png")), /no longer available/);
});

test("findFiles: fd where there is one, find where there isn't", async () => {
  reset();
  const d = folder(["src/main.js", "docs/guide.md", "node_modules/x/main.js"]);
  if (which("fd")) {
    const r = await M.findFiles("sim", d, "main");
    assert.equal(r.fd, true);
    assert.deepEqual(r.paths.sort(), ["node_modules/x/main.js", "src/main.js"], "fd: the files whose path has m, a, i, n in order");
  }
  state.path = shims(BASIC); M.forget();
  const r = await M.findFiles("sim", d, "main");
  assert.equal(r.fd, false);
  assert.deepEqual(r.paths.sort(), ["docs/guide.md", "src/main.js"], "find lists every file but node_modules and .git");
  reset();
  await settle();
});
