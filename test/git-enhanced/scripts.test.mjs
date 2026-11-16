// The sh scripts (scripts.js), run for real under the system's sh, under dash (what Linux machines run
// as sh) and with GNU's base64 instead of the system's where it is installed (a PATH of shims).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";

const S = await mod("scripts.js");

const which = (c) => { const r = spawnSync("sh", ["-c", `command -v ${c}`], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
// A folder of links to programs, for a PATH that has only those (and GNU's base64 by its name).
function shims(names, gnu = {}) {
  const d = tempDir("git-enhanced-bin-");
  for (const n of names) { const p = which(n); if (p) symlinkSync(p, join(d, n)); }
  for (const [n, g] of Object.entries(gnu)) { const p = which(g); if (p) symlinkSync(p, join(d, n)); }
  return d;
}
const BASIC = ["sh", "mktemp", "wc", "tr", "cksum", "rm", "cat", "printf", "sleep", "kill", "git", "uname", "getconf", "touch", "ps", "od", "dirname", "basename"];
const dash = existsSync("/bin/dash") ? "/bin/dash" : which("dash");
const gnuBase64 = which("gbase64") ?? (existsSync("/opt/homebrew/opt/coreutils/libexec/gnubin/base64") ? "/opt/homebrew/opt/coreutils/libexec/gnubin/base64" : null);
export const VARIANTS = [
  { name: "sh", sh: "sh", path: process.env.PATH },
  ...(dash ? [{ name: "dash", sh: dash, path: process.env.PATH }] : []),
  ...(dash && gnuBase64 ? [{ name: "dash with GNU base64", sh: dash, path: (() => { const d = shims(BASIC); symlinkSync(gnuBase64, join(d, "base64")); return d; })() }] : []),
];
const run = (v, script, args = [], cwd = "/tmp", env = {}) => spawnSync(v.sh, ["-c", script, "sh", ...args], { cwd, encoding: "utf8", env: { ...process.env, PATH: v.path, ...env } });
const file = (name, bytes) => ({ name, base64: Buffer.from(bytes).toString("base64"), size: Buffer.from(bytes).length });

test("chunks and caps: base64 in pieces under 128 KiB, what fits a machine's ARG_MAX", () => {
  const b64 = randomBytes(300000).toString("base64"), parts = S.chunks(b64);
  assert.ok(S.CHUNK % 4 === 0 && S.CHUNK < 131072);
  assert.equal(parts.join(""), b64);
  assert.ok(parts.every((p) => p.length <= S.CHUNK && p.length % 4 === 0));
  assert.deepEqual(S.chunks(""), []);
  assert.equal(S.putCap(1048576), 737280, "macOS: 1 MiB of arguments");
  assert.equal(S.putCap(2097152), 1024 * 1024, "Linux: capped at 1 MiB");
  assert.equal(S.putCap(0), S.PUT_MAX, "unknown");
  assert.deepEqual(S.filesArgs([file("a", "x")], ["--cached", 3]), ["1", "a", "1", "1", "eA==", "--cached", "3"]);
});

for (const v of VARIANTS) {
  test(`FILES_SH (${v.name}): the files arrive whole, in a temp folder that goes; the arguments after them`, () => {
    const tmp = tempDir("git-enhanced-files-");
    const big = randomBytes(250000), text = "한국어 é\r\nline two\0and a NUL\n";
    const body = 'for f in "$d"/*; do printf "%s %s\\n" "${f##*/}" "$(cksum < "$f")"; done; printf "args:"; printf "%s|" "$@"; echo; echo "$d" > "$TMPDIR/where"';
    const r = run(v, S.FILES_SH + body, S.filesArgs([file("patch", text), file("big.bin", big)], ["--cached", "-R", "a b"]), "/tmp", { TMPDIR: tmp });
    assert.equal(r.status, 0, r.stderr);
    const want = (bytes) => spawnSync("cksum", { input: bytes, encoding: "utf8" }).stdout.trim();
    assert.match(r.stdout, new RegExp(`big.bin ${want(big)}`));
    assert.match(r.stdout, new RegExp(`patch ${want(Buffer.from(text))}`));
    assert.match(r.stdout, /args:--cached\|-R\|a b\|/);
    const where = readFileSync(join(tmp, "where"), "utf8").trim();
    assert.ok(where.startsWith(tmp) && !existsSync(where), "the temp folder is gone");
    // A file that arrives short is refused; so is a name that isn't one.
    const bad = S.filesArgs([{ name: "p", base64: Buffer.from("abc").toString("base64"), size: 4 }]);
    const short = run(v, S.FILES_SH + "echo ran", bad, "/tmp", { TMPDIR: tmp });
    assert.notEqual(short.status, 0); assert.match(short.stderr, /cut short/); assert.doesNotMatch(short.stdout, /ran/);
    const sneaky = run(v, S.FILES_SH + "echo ran", S.filesArgs([file("../x", "a")]), "/tmp", { TMPDIR: tmp });
    assert.equal(sneaky.status, 2); assert.doesNotMatch(sneaky.stdout, /ran/);
    assert.deepEqual(readdirSync(tmp).filter((n) => n !== "where"), [], "nothing left behind");
  });

  test(`LIMIT_SH (${v.name}): in time its status and output; too long, stopped (142) with what it started`, async () => {
    const tmp = tempDir("git-enhanced-limit-");
    const ok = run(v, S.LIMIT_SH + `limit 5 "$1/out" "$1/err" sh -c 'echo hi; echo oops >&2; exit 3'; c=$?; cat "$1/out" "$1/err"; exit $c`, [tmp]);
    assert.equal(ok.status, 3); assert.equal(ok.stdout, "hi\noops\n");
    assert.equal(ok.stderr, "", "no job notices from the shell");
    const said = run(v, S.LIMIT_SH + 'echo "mine" >&3; exit 4');
    assert.equal(said.status, 4); assert.equal(said.stderr, "mine\n", "the script's own messages go to fd 3, the caller's stderr");
    const started = Date.now();
    // The job starts a child of its own; both go when the time is up (the group where there is one).
    const slow = run(v, S.LIMIT_SH + `limit 1 "$1/out" "$1/err" sh -c 'sleep 30 & echo $! > "$0/child"; sleep 30' "$1"; echo "status $?"`, [tmp]);
    const took = Date.now() - started;
    assert.match(slow.stdout, /status 142/);
    assert.ok(took < 4000, `stopped after ${took} ms`);
    assert.equal(existsSync(join(tmp, "out.stopped")), false);
    const child = Number(readFileSync(join(tmp, "child"), "utf8"));
    await new Promise((r) => setTimeout(r, 300));
    const alive = spawnSync("kill", ["-0", String(child)]).status === 0;
    if (alive) spawnSync("kill", ["-9", String(child)]);
    if (v.sh === "sh") assert.equal(alive, false, "sh (bash) gives the job a process group: its child goes too");
  });

  test(`STATE_SH (${v.name}): changes with HEAD, the index, an edit of the same size, a shown untracked file`, () => {
    const d = tempDir("git-enhanced-state-");
    const git = (...a) => spawnSync("git", a, { cwd: d, encoding: "utf8" });
    assert.equal(run(v, S.STATE_SH, [], d).stdout.trim(), "none");
    git("init", "-q"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
    writeFileSync(join(d, "a.txt"), "one\n"); git("add", "-A"); git("commit", "-qm", "one");
    const state = (...files) => { const r = run(v, S.STATE_SH, files, d); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    const s0 = state();
    assert.equal(state(), s0, "nothing changed: the same");
    writeFileSync(join(d, "a.txt"), "two\n");
    const s1 = state(); assert.notEqual(s1, s0);
    writeFileSync(join(d, "a.txt"), "six\n");
    const s2 = state(); assert.notEqual(s2, s1, "an edit of the same size");
    git("add", "a.txt");
    const s3 = state(); assert.notEqual(s3, s2, "staged");
    writeFileSync(join(d, "new.txt"), "x\n");
    const s4 = state("new.txt"); assert.notEqual(s4, s3, "a new file");
    writeFileSync(join(d, "new.txt"), "y\n");
    assert.notEqual(state("new.txt"), s4, "the shown untracked file's content");
    git("commit", "-qm", "two");
    assert.notEqual(state("new.txt"), s4, "HEAD moved");
    // Nothing written under .git by looking.
    const before = readdirSync(join(d, ".git")).sort().join(",");
    state(); assert.equal(readdirSync(join(d, ".git")).sort().join(","), before);
  });

  test(`PROBE (${v.name}): the system, ARG_MAX and the programs found`, () => {
    const f = S.parseFacts(run(v, S.PROBE, ["git", "sh", "no-such-program-here"]).stdout);
    assert.ok(["Darwin", "Linux"].includes(f.os));
    assert.ok(f.argMax > 100000);
    assert.ok(f.tools.has("git") && f.tools.has("sh") && !f.tools.has("no-such-program-here"));
  });
}

test("parseFacts and why", () => {
  assert.deepEqual(S.parseFacts(""), { os: "unknown", argMax: 0, tools: new Set() });
  assert.equal(S.why("fatal: no\nmore"), "fatal: no");
  assert.equal(S.why("", "failed"), "failed");
});
