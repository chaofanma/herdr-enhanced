import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { TIMEOUT, SLOW, LIMIT, SYSTEM, AGENTS, agentOf, cut, prompt, piArgs, penCommand, PEN_SH, penArgs, readAnswer, readClaude, readOpencode, readText, readPen } = await mod("commitmsg.js");

// What `pi -p --mode json …` prints with piArgs: a model that answers (pi-ok), and one whose provider
// answers 500 while pi retries until the 20 s limit (pi-retry-timeout; the watchdog reports 142).
const OK = readFileSync(new URL("./fixtures/pi-ok.jsonl", import.meta.url), "utf8");
const RETRY = readFileSync(new URL("./fixtures/pi-retry-timeout.jsonl", import.meta.url), "utf8");

test("piArgs is pi one-shot, JSON lines out; no model given, pi's own default", () => {
  const base = ["-p", "--mode", "json", "--no-session", "--no-extensions", "--no-skills", "--no-tools", "--offline", "--thinking", "off"];
  assert.deepEqual(piArgs("", "PROMPT"), [...base, "--system-prompt", SYSTEM, "PROMPT"]);
  assert.deepEqual(piArgs("example/fast-model", "PROMPT"), [...base, "--model", "example/fast-model", "--system-prompt", SYSTEM, "PROMPT"]);
  assert.equal(TIMEOUT, 20);
});

test("cut keeps short text and cuts long text at a line end", () => {
  assert.equal(cut("a\nb\n", 100), "a\nb\n");
  const long = Array.from({ length: 2000 }, (_, i) => `+line ${i}`).join("\n");
  const c = cut(long, LIMIT);
  assert.ok(c.length < LIMIT + 80);
  const [kept, note] = [c.slice(0, c.lastIndexOf("\n")), c.slice(c.lastIndexOf("\n") + 1)];
  assert.ok(long.startsWith(kept + "\n"));
  assert.match(note, /^\[… \d+ more characters of the diff not shown\]$/);
  assert.equal(Number(/\d+/.exec(note)[0]), long.length - kept.length);
});

test("prompt has the subjects, the diff and the new files", () => {
  const p = prompt({ diff: "diff --git a/x b/x\n+y\n", staged: true, subjects: ["Fix the parser", "Add a README"] });
  assert.equal(p, "Write the commit message for this change.\n\nRecent commit subjects, newest first:\n- Fix the parser\n- Add a README\n\nThe staged diff (what the commit takes):\ndiff --git a/x b/x\n+y\n");
  const u = prompt({ diff: "", staged: false, untracked: ["a.txt", "b/c.txt"], subjects: [] });
  assert.equal(u, "Write the commit message for this change.\n\nNew files, not in the diff:\na.txt\nb/c.txt");
  const w = prompt({ diff: "d\n", staged: false, untracked: Array.from({ length: 105 }, (_, i) => `f${i}`) });
  assert.match(w, /The uncommitted diff \(nothing is staged, so the commit takes every change\):\nd\n/);
  assert.match(w, /\nf99\n\[… 5 more\]$/);
  assert.ok(prompt({ diff: "x".repeat(50000), staged: true }).length < LIMIT + 300);
});

test("readAnswer takes the last assistant message of a real run", () => {
  assert.deepEqual(readAnswer({ code: 0, stdout: OK, stderr: "" }), { text: "Add a todo item removal function" });
});

test("readAnswer reports a real retry loop cut by the alarm", () => {
  assert.deepEqual(readAnswer({ code: 142, stdout: RETRY, stderr: "" }), { error: "timed out after 20 s (500 the upstream rejected the request)" });
  // Killed another way: the provider's error still says what went wrong.
  assert.deepEqual(readAnswer({ code: 1, stdout: RETRY, stderr: "" }), { error: "500 the upstream rejected the request" });
});

const line = (e) => JSON.stringify(e);
const assistant = (message) => line({ type: "message_end", message: { role: "assistant", ...message } });

test("readAnswer joins text parts and drops fences and quotes", () => {
  const stdout = [line({ type: "session" }), assistant({ content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "Fix the parser\n\n" }, { type: "text", text: "Handle empty input." }], stopReason: "stop" })].join("\n");
  assert.deepEqual(readAnswer({ code: 0, stdout }), { text: "Fix the parser\n\nHandle empty input." });
  assert.deepEqual(readAnswer({ code: 0, stdout: assistant({ content: [{ type: "text", text: "```\nAdd tests\n```" }], stopReason: "stop" }) }), { text: "Add tests" });
  assert.deepEqual(readAnswer({ code: 0, stdout: assistant({ content: [{ type: "text", text: "\"Add tests\"" }], stopReason: "stop" }) }), { text: "Add tests" });
  assert.deepEqual(readAnswer({ code: 0, stdout: assistant({ content: [{ type: "text", text: "Use \"x\" over \"y\"" }], stopReason: "stop" }) }), { text: "Use \"x\" over \"y\"" });
});

test("readAnswer reports errors in a few words", () => {
  const failed = assistant({ content: [], stopReason: "error", errorMessage: "503 model unavailable" });
  assert.deepEqual(readAnswer({ code: 0, stdout: failed }), { error: "503 model unavailable" });
  const gaveUp = [failed, line({ type: "auto_retry_start", attempt: 1, errorMessage: "503 model unavailable" }), line({ type: "auto_retry_end", success: false, finalError: "503 still unavailable" })].join("\n");
  assert.deepEqual(readAnswer({ code: 0, stdout: gaveUp }), { error: "503 still unavailable" });
  assert.deepEqual(readAnswer({ code: 142, stdout: "" }), { error: "timed out after 20 s" });
  assert.deepEqual(readAnswer({ code: 1, stdout: "", stderr: "warning: x\nError: Model \"nope\" not found\n" }), { error: "Error: Model \"nope\" not found" });
  assert.deepEqual(readAnswer({ code: 2, stdout: "", stderr: "" }), { error: "pi exited with code 2" });
  assert.deepEqual(readAnswer({ code: 0, stdout: assistant({ content: [{ type: "text", text: "  " }], stopReason: "stop" }) }), { error: "pi answered with no message" });
});

test("penCommand: each agent's one-shot command; the model only when one is set", () => {
  const full = `${SYSTEM}\n\nP`;
  assert.deepEqual(penCommand({ agent: "pi", text: "P" }), { program: "pi", argv: ["pi", ...piArgs("", "P")], timeout: TIMEOUT });
  assert.ok(!penCommand({ agent: "pi", text: "P" }).argv.includes("--model"), "no model of ours: pi's own default");
  assert.deepEqual(penCommand({ agent: "pi", model: "x/y", text: "P" }).argv.slice(-4), ["x/y", "--system-prompt", SYSTEM, "P"]);
  assert.deepEqual(penCommand({ agent: "claude", text: "P" }).argv, ["claude", "-p", "--output-format", "json", full]);
  assert.deepEqual(penCommand({ agent: "claude", model: "sonnet", text: "P" }).argv, ["claude", "-p", "--output-format", "json", "--model", "sonnet", full]);
  assert.deepEqual(penCommand({ agent: "codex", text: "P" }).argv, ["codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--output-last-message", "@LAST@", full]);
  assert.deepEqual(penCommand({ agent: "codex", model: "o4", text: "P" }).argv.slice(-3), ["--model", "o4", full]);
  assert.deepEqual(penCommand({ agent: "opencode", model: "p/m", text: "P" }).argv, ["opencode", "run", "--format", "json", "--model", "p/m", full]);
  assert.equal(penCommand({ agent: "codex", text: "P" }).timeout, SLOW);
  // Custom: {prompt} replaced, else last; {model} replaced; nothing set: nothing to run.
  assert.deepEqual(penCommand({ agent: "custom", command: ["llm", "-m", "{model}", "--", "{prompt}"], model: "m1", text: "P" }).argv, ["llm", "-m", "m1", "--", full]);
  assert.deepEqual(penCommand({ agent: "custom", command: ["my-ai", "--short"], text: "P" }).argv, ["my-ai", "--short", full]);
  assert.equal(penCommand({ agent: "custom", command: [], text: "P" }), null);
  assert.equal(penCommand({ agent: "custom", command: [" "], text: "P" }), null);
  assert.deepEqual(AGENTS.map((a) => a.id), ["pi", "claude", "codex", "opencode", "custom"]);
  assert.equal(agentOf("nope").id, "pi");
});

test("penCommand for your own command as the settings window stores it (fields.js commitCommandOf)", async () => {
  const { COMMIT_AGENTS, commitCommandOf } = await mod("fields.js");
  assert.equal(AGENTS, COMMIT_AGENTS, "the pen and the settings window offer one list");
  const full = `${SYSTEM}\n\nP`, run = (line, model = "") => penCommand({ agent: "custom", command: commitCommandOf(line).argv, model, text: "P" });
  // With {prompt}: replaced where it stands, also inside a word; {model} too (empty without one).
  assert.deepEqual(run("'my ai' --model {model} --ask='Q: {prompt}' --quiet", "m1"), { program: "my ai", argv: ["my ai", "--model", "m1", `--ask=Q: ${full}`, "--quiet"], timeout: SLOW });
  assert.deepEqual(run("llm -m {model} {prompt}").argv, ["llm", "-m", "", full]);
  // Without {prompt}: the prompt goes last.
  assert.deepEqual(run("llm -m {model} --no-stream", "m2").argv, ["llm", "-m", "m2", "--no-stream", full]);
  // What isn't stored: a quote left open, nothing typed.
  assert.match(commitCommandOf("llm 'oops").error, /quote that isn't closed/);
  assert.match(commitCommandOf("  ").error, /type the command/);
});

// PEN_SH with stand-in agents (sh scripts on a PATH of their own), as the pen runs it.
import { spawnSync } from "node:child_process";
import { writeFileSync as write, chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
const bin = tempDir("git-enhanced-pen-bin-"), tmp = tempDir("git-enhanced-pen-tmp-");
const agent = (name, body) => { write(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
const pen = (cmd, seconds = cmd.timeout) => {
  const r = spawnSync("sh", ["-c", PEN_SH, "sh", ...penArgs({ ...cmd, timeout: seconds })], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

test("PEN_SH: the agent's output; codex's last-message file; stopped in time; not installed", () => {
  agent("codex", 'while [ $# -gt 0 ]; do [ "$1" = --output-last-message ] && { shift; printf "Fix the parser\\n\\nIt dropped empty lines.\\n" > "$1"; }; shift; done; echo "lots of progress on stdout"; pwd >&2');
  const c = penCommand({ agent: "codex", text: "P" }), r = pen(c);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readPen("codex", r, c), { text: "Fix the parser\n\nIt dropped empty lines." });
  assert.ok(r.stderr.trim().startsWith(tmp), "it ran in an empty temp folder");
  agent("claude", 'printf \'{"type":"result","subtype":"success","is_error":false,"result":"```\\\\nAdd a pen\\\\n```"}\\n\'');
  const cl = penCommand({ agent: "claude", text: "P" });
  assert.deepEqual(readPen("claude", pen(cl), cl), { text: "Add a pen" });
  agent("opencode", "sleep 30");
  const oc = penCommand({ agent: "opencode", text: "P" }), t0 = Date.now(), slow = pen(oc, 1);
  assert.equal(slow.code, 142); assert.ok(Date.now() - t0 < 5000);
  assert.deepEqual(readPen("opencode", slow, { ...oc, timeout: 1 }), { error: "timed out after 1 s" });
  const missing = penCommand({ agent: "custom", command: ["no-such-agent-here"], text: "P" }), m = pen(missing);
  assert.equal(m.code, 127);
  assert.deepEqual(readPen("custom", m, missing), { error: "no-such-agent-here isn't installed here" });
  agent("my-ai", 'printf "\\033[1mUpdate the docs\\033[0m\\n"');
  const mine = penCommand({ agent: "custom", command: ["my-ai"], text: "P" });
  assert.deepEqual(readPen("custom", pen(mine), mine), { text: "Update the docs" }, "terminal escapes dropped");
  assert.deepEqual(readdirSync(tmp), [], "the temp folder is gone");
});

test("readClaude, readOpencode and readText: answers and errors", () => {
  assert.deepEqual(readClaude({ code: 0, stdout: '{"type":"result","subtype":"success","is_error":false,"result":"\\"Bump the version\\""}' }), { text: "Bump the version" });
  assert.deepEqual(readClaude({ code: 1, stdout: '{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key · Please run /login"}' }), { error: "Invalid API key · Please run /login" });
  assert.deepEqual(readClaude({ code: 0, stdout: "Plain text answer\n" }), { text: "Plain text answer" });
  assert.deepEqual(readClaude({ code: 142, stdout: "" }), { error: "timed out after 60 s" });
  // opencode's events (the error's shape as opencode prints a 403).
  const ok = [{ type: "step_start", part: {} }, { type: "text", part: { type: "text", text: "Add the History menus" } }, { type: "step_finish", part: {} }].map((e) => JSON.stringify(e)).join("\n");
  assert.deepEqual(readOpencode({ code: 0, stdout: ok }), { text: "Add the History menus" });
  const err = JSON.stringify({ type: "error", timestamp: 1, sessionID: "ses_x", error: { name: "APIError", data: { message: "Forbidden: {\"error\":{\"message\":\"Access from this domain is not allowed\"}}", statusCode: 403, isRetryable: false } } });
  assert.deepEqual(readOpencode({ code: 0, stdout: err }), { error: "Forbidden: {\"error\":{\"message\":\"Access from this domain is not allowed\"}}" });
  assert.deepEqual(readOpencode({ code: 1, stdout: "", stderr: "Error: no provider\n" }), { error: "Error: no provider" });
  assert.deepEqual(readText({ code: 0, stdout: "  \n" }, "codex"), { error: "codex answered with no message" });
  assert.deepEqual(readText({ code: 3, stdout: "", stderr: "boom\n" }, "my-ai"), { error: "boom" });
});
