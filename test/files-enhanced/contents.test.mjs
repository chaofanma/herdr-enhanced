import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { SEARCH, rgArgs, grepArgs, jsPattern, utf16At, parseRg, parseGrep, searchError, replacePattern, replacementFor, applyReplacements, caseless } = await mod("contents.js");

const q = (query, o = {}) => ({ query, matchCase: false, wholeWord: false, regex: false, ...o });

test("rg's arguments", () => {
  assert.deepEqual(rgArgs(q("a.b")), ["--json", "--no-config", "--no-require-git", "--crlf", "--max-filesize", "2M", "--hidden", "--smart-case", "-g", "!.git", "--fixed-strings", "--", "a.b", "."]);
  const r = rgArgs(q("fo(o", { regex: true, matchCase: true }), { hidden: false, exclude: ["dist", " ", "*.min.js"] });
  assert.deepEqual(r.slice(6), ["--case-sensitive", "-g", "!.git", "-g", "!dist", "-g", "!*.min.js", "--engine", "auto", "--regexp", "fo(o", "--", "."]);
  assert.deepEqual(rgArgs(q("a.b", { wholeWord: true })).slice(-4), ["--regexp", "\\ba\\.b\\b", "--", "."]);
  assert.deepEqual(rgArgs(q(".x", { wholeWord: true })).slice(-4), ["--regexp", "\\.x\\b", "--", "."]);
  assert.deepEqual(rgArgs(q("--")).slice(-6), ["--engine", "auto", "--regexp", "\\-\\-", "--", "."]);
});

test("grep's arguments", () => {
  assert.deepEqual(grepArgs(q("Ab", { wholeWord: true }), { hidden: false, exclude: ["dist", "a/b"] }),
    ["-rnI", "--exclude-dir=.git", "--exclude-dir=node_modules", "--exclude=.*", "--exclude-dir=.*", "--exclude=dist", "--exclude-dir=dist", "-w", "-F", "-e", "Ab", "--", "."]);
  assert.deepEqual(grepArgs(q("ab", { regex: true })).slice(-6), ["-i", "-E", "-e", "ab", "--", "."]);
  assert.equal(caseless(q("ab")), true); assert.equal(caseless(q("aB")), false); assert.equal(caseless(q("ab", { matchCase: true })), false);
});

test("the pattern in JavaScript", () => {
  assert.equal(jsPattern(q("a.b")).re.source, "a\\.b");
  assert.equal(jsPattern(q("a.b")).re.flags, "imuy");
  assert.equal(jsPattern(q("Ab")).re.ignoreCase, false);
  assert.equal(jsPattern(q("(\\w+)\\-x", { regex: true })).re.unicode, false, "\\- is fine without u");
  assert.match(jsPattern(q("a(?<=b", { regex: true })).error, /Invalid regular expression/);
  assert.match(jsPattern(q("(?i)ab", { regex: true })).error, /Invalid/, "rg's inline flags aren't JavaScript's");
});

test("byte offsets as UTF-16 indexes", () => {
  const at = utf16At("héllo 한국 😀 x");
  assert.equal(at(0), 0); assert.equal(at(1), 1); assert.equal(at(3), 2); assert.equal(at(7), 6);
  assert.equal(at(10), 7); assert.equal(at(13), 8); assert.equal(at(14), 9); assert.equal(at(18), 11); assert.equal(at(19), 12);
});

const rgLine = (path, line, text, subs) => JSON.stringify({ type: "match", data: { path: { text: path }, lines: { text }, line_number: line, absolute_offset: 0, submatches: subs.map(([start, end]) => ({ match: { text: "" }, start, end })) } });

test("rg --json output: files in order, lines, ranges in UTF-16", () => {
  const out = [JSON.stringify({ type: "begin", data: { path: { text: "./a.txt" } } }),
    rgLine("./a.txt", 1, "one needle\n", [[4, 10]]),
    rgLine("./a.txt", 3, "한국 needle needle\r\n", [[7, 13], [14, 20]]),
    rgLine("./b/c.md", 2, "x", []),
    JSON.stringify({ type: "match", data: { path: { bytes: "AAA=" }, lines: { text: "x\n" }, line_number: 1, submatches: [] } }),
    '{"type":"match","data":{"path":{"text":"./cut', ""].join("\n");
  const r = parseRg(out);
  assert.deepEqual(r.files, [
    { path: "a.txt", matches: [{ line: 1, text: "one needle", ranges: [[4, 10]] }, { line: 3, text: "한국 needle needle", ranges: [[3, 9], [10, 16]] }] },
    { path: "b/c.md", matches: [{ line: 2, text: "x", ranges: [[0, 1]], exact: false }] }]);
  assert.equal(r.count, 4); assert.equal(r.lines, 3); assert.equal(r.skipped, 1); assert.equal(r.full, false);
  const capped = parseRg(out, 2);
  assert.equal(capped.count, 2); assert.equal(capped.full, true);
  assert.deepEqual(capped.files[0].matches[1].ranges, [[3, 9]]);
});

test("grep output, matches found again in JavaScript", () => {
  const r = parseGrep("./a.txt:1:one Needle needle\n./a:b.txt:12:needle\nnoise\n", jsPattern(q("needle")).re);
  assert.deepEqual(r.files, [{ path: "a.txt", matches: [{ line: 1, text: "one Needle needle", ranges: [[4, 10], [11, 17]] }] }, { path: "a:b.txt", matches: [{ line: 12, text: "needle", ranges: [[0, 6]] }] }]);
});

test("errors said shortly", () => {
  assert.equal(searchError("rg: regex parse error:\n    (?:ne(edle)\n    ^\nerror: unclosed group\n"), "Regex parse error: unclosed group");
  assert.equal(searchError("rg: ./x: Permission denied (os error 13)\n"), "./x: Permission denied (os error 13)");
  assert.equal(searchError(""), null);
});

test("replace patterns: escapes, $0, groups, named groups, case", () => {
  const re = /(\w+)@(?<host>\w+)/y, m = re.exec("bob@home");
  const r = (text, regex = true) => replacementFor(m, replacePattern(text, regex));
  assert.equal(r("$2:$1"), "home:bob"); assert.equal(r("$0!"), "bob@home!"); assert.equal(r("$&"), "bob@home");
  assert.equal(r("$<host>"), "home"); assert.equal(r("$$1"), "$1"); assert.equal(r("$9"), "$9"); assert.equal(r("a\\nb\\tc\\\\d"), "a\nb\tc\\d");
  assert.equal(r("\\u$1"), "Bob"); assert.equal(r("\\U$1-$2"), "BOB-home"); assert.equal(r("\\l\\U$2"), "hOME");
  assert.equal(r("$`$'"), "");
  assert.equal(r("$1 \\n", false), "$1 \\n", "a literal search's replacement is used as typed");
});

test("applying replacements to a file's text", () => {
  const text = "a needle\r\nNeedle and needle\nend needle";
  const lit = applyReplacements(text, [{ line: 1, start: 2, end: 8, matched: "needle" }, { line: 2, start: 0, end: 6, matched: "Needle" }, { line: 3, start: 4, end: 10, matched: "needle" }],
    null, replacePattern("pin", false));
  assert.deepEqual(lit, { text: "a pin\r\npin and needle\nend pin", replaced: 3, skipped: 0 });
  // A match that isn't there any more is left alone.
  assert.deepEqual(applyReplacements(text, [{ line: 2, start: 11, end: 17, matched: "needle" }, { line: 9, start: 0, end: 1, matched: "x" }, { line: 1, start: 0, end: 1, matched: "z" }], null, replacePattern("pin", false)),
    { text: "a needle\r\nNeedle and pin\nend needle", replaced: 1, skipped: 2 });
  // A regex: groups from the match, run where it was found (so ^ and lookbehind see the line).
  const { re } = jsPattern(q("(?<=and )(n)eedle", { regex: true }));
  assert.deepEqual(applyReplacements(text, [{ line: 2, start: 11, end: 17, matched: "needle" }], re, replacePattern("\\U$1$0", true)),
    { text: "a needle\r\nNeedle and Nneedle\nend needle", replaced: 1, skipped: 0 });
  const start = jsPattern(q("^end (\\w+)", { regex: true })).re;
  assert.equal(applyReplacements(text, [{ line: 3, start: 0, end: 10, matched: "end needle" }], start, replacePattern("$1 end", true)).text, "a needle\r\nNeedle and needle\nneedle end");
});

// The wrapper and rg (or grep) on a real folder.
const rg = spawnSync("sh", ["-c", "command -v rg"]).status === 0;
test("SEARCH runs rg, stops at the match limit, says when the program is missing", { skip: !rg && "rg isn't installed" }, () => {
  const started = Date.now();
  const d = tempDir("files-enhanced-test-contents-");
  mkdirSync(join(d, ".git")); mkdirSync(join(d, "src"));
  writeFileSync(join(d, ".git/x"), "needle"); writeFileSync(join(d, "src/a.txt"), "one needle\nNeedle two\nneedle needle\n"); writeFileSync(join(d, ".hidden"), "needle");
  const run = (max, ...args) => spawnSync("sh", ["-c", SEARCH, "files", "5", String(max), "6000000", ...args], { cwd: d, encoding: "utf8" });
  let r = run(2000, "1", "rg", ...rgArgs(q("needle")));
  assert.equal(r.status, 0, r.stderr);
  const all = parseRg(r.stdout);
  assert.deepEqual(all.files.map(f => f.path).sort(), [".hidden", "src/a.txt"], ".git is never searched");
  assert.equal(all.count, 5);
  assert.equal(parseRg(run(2000, "1", "rg", ...rgArgs(q("needle"), { hidden: false })).stdout).files.length, 1);
  r = run(2, "1", "rg", ...rgArgs(q("needle")));
  assert.equal(parseRg(r.stdout).lines, 2);
  r = run(2000, "1", "rg", ...rgArgs(q("ne(edle", { regex: true })));
  assert.equal(r.status, 2); assert.equal(searchError(r.stderr), "Regex parse error: unclosed group");
  assert.equal(run(2000, "1", "no-such-program-here").status, 127);
  r = run(2000, "0", "grep", ...grepArgs(q("needle")));
  assert.equal(parseGrep(r.stdout, jsPattern(q("needle")).re).count, 5);
  assert.ok(Date.now() - started < 3000, "no search waited for its time limit");
  // The time limit: a program that takes longer is stopped (143) with what it printed.
  r = spawnSync("sh", ["-c", SEARCH, "files", "1", "10", "1000", "0", "sh", "-c", "echo early; sleep 3; echo late"], { encoding: "utf8" });
  assert.equal(r.status, 143); assert.equal(r.stdout, "early\n");
});
