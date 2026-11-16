// Writing a commit message with an agent (the pen by the commit message box): the prompt, each
// agent's one-shot command line (pi -p, claude -p, codex exec, opencode run, or the person's own
// command from the settings), the watchdog script that runs it, and reading its answer. The agent
// runs on this computer in an empty temp folder (it needs nothing but its prompt); the diff, read
// from wherever the repository is, goes into the prompt, so it reaches that agent's model provider.
// The answer only fills the message box: nothing commits by itself.
// No Herdr imports: tested with node (test/git-enhanced/commitmsg.test.mjs).
import { ID } from "./id.js";
import { LIMIT_SH } from "./scripts.js";
import { COMMIT_AGENTS } from "./fields.js";

/** Seconds pi gets: pi retries provider errors for minutes, and a message doesn't take that long. */
export const TIMEOUT = 20;
/** Seconds the other agents get: they take longer to start. */
export const SLOW = 60;
/** How much diff the prompt carries, in characters. */
export const LIMIT = 12000;
export const SYSTEM = "You write git commit messages. Output only the message: a subject line of at most 72 characters in the imperative mood, matching the style of the recent subjects; then, only if the change needs it, a blank line and a short body. No quotes, no code fences.";

/** `text` cut to about `limit` characters at a line end, saying how much was left out. */
export function cut(text, limit = LIMIT) {
  if (text.length <= limit) return text;
  const end = text.lastIndexOf("\n", limit), kept = text.slice(0, end > limit / 2 ? end : limit);
  return `${kept}\n[… ${text.length - kept.length} more characters of the diff not shown]`;
}

/** The prompt: the recent subjects (for their style), the diff, the new files' names.
 *  `staged`: the diff is what's staged; else it's every uncommitted change (Commit stages them all). */
export function prompt({ diff = "", staged, untracked = [], subjects = [] }) {
  const parts = ["Write the commit message for this change."];
  if (subjects.length) parts.push(`Recent commit subjects, newest first:\n${subjects.map((s) => `- ${s}`).join("\n")}`);
  if (diff.trim()) parts.push(`${staged ? "The staged diff (what the commit takes)" : "The uncommitted diff (nothing is staged, so the commit takes every change)"}:\n${cut(diff)}`);
  if (untracked.length) {
    const names = untracked.slice(0, 100), more = untracked.length - names.length;
    parts.push(`New files, not in the diff:\n${names.join("\n")}${more ? `\n[… ${more} more]` : ""}`);
  }
  return parts.join("\n\n");
}

/** pi one-shot (JSON lines out): its arguments after the program. */
export const piArgs = (model, text) => ["-p", "--mode", "json", "--no-session", "--no-extensions", "--no-skills", "--no-tools", "--offline", "--thinking", "off",
  ...(model ? ["--model", model] : []), "--system-prompt", SYSTEM, text];

/** The agents the pen can write with, in the settings' order (panelsettings.js commitAgent): the
 *  list the settings window offers too (fields.js, shared). */
export const AGENTS = COMMIT_AGENTS;
export const agentOf = (id) => AGENTS.find((a) => a.id === id) ?? AGENTS[0];

/** What runs for the settings' `agent` with `model` ("" for the agent's own) and, for "custom",
 *  `command` (an argv: "{prompt}" is replaced by the prompt, else the prompt goes last; "{model}" by
 *  the model): `{ argv, timeout, program }`, or null when there is nothing to run (a custom command
 *  that is empty). Agents other than pi get the instructions at the top of the prompt, since their
 *  flags for a system prompt differ between versions. An argument "@LAST@" is the file codex writes
 *  its last message to (PEN_SH). */
export function penCommand({ agent = "pi", model = "", command = [], text }) {
  const full = `${SYSTEM}\n\n${text}`, m = String(model ?? "").trim();
  if (agent === "pi") return { program: "pi", argv: ["pi", ...piArgs(m, text)], timeout: TIMEOUT };
  if (agent === "claude") return { program: "claude", argv: ["claude", "-p", "--output-format", "json", ...(m ? ["--model", m] : []), full], timeout: SLOW };
  if (agent === "codex") return { program: "codex", argv: ["codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--output-last-message", "@LAST@", ...(m ? ["--model", m] : []), full], timeout: SLOW };
  if (agent === "opencode") return { program: "opencode", argv: ["opencode", "run", "--format", "json", ...(m ? ["--model", m] : []), full], timeout: SLOW };
  const argv = (Array.isArray(command) ? command : []).filter((a) => typeof a === "string");
  if (!argv.length || !argv[0].trim()) return null;
  const placed = argv.some((a) => a.includes("{prompt}"));
  const filled = argv.map((a) => a.split("{prompt}").join(full).split("{model}").join(m));
  return { program: argv[0], argv: placed ? filled : [...filled, full], timeout: SLOW };
}

/** Runs an agent's argv under the watchdog, in an empty temp folder: `sh -c PEN_SH sh <seconds>
 *  <argv…>`. Its output is what it printed, or the file an "@LAST@" argument named when it wrote one;
 *  its exit status is the agent's (142 when stopped, 127 when it isn't installed). */
export const PEN_SH = LIMIT_SH
  + `s=$1; shift; d=$(mktemp -d "\${TMPDIR:-/tmp}/${ID}-pen.XXXXXX") || exit 1; trap 'rm -rf "$d"' EXIT; trap 'exit 143' HUP INT TERM; `
  + 'n=$#; i=0; while [ "$i" -lt "$n" ]; do a=$1; shift; [ "$a" = @LAST@ ] && a="$d/last"; set -- "$@" "$a"; i=$((i + 1)); done; '
  + 'command -v "$1" >/dev/null 2>&1 || { echo "$1 isn\'t installed here" >&3; exit 127; }; '
  + 'cd "$d" || exit 1; limit "$s" "$d/out" "$d/err" "$@"; c=$?; '
  + 'if [ -s "$d/last" ]; then cat "$d/last"; else cat "$d/out"; fi; cat "$d/err" >&3; exit "$c"';
export const penArgs = (cmd) => [String(cmd.timeout), ...cmd.argv];

// A provider's error in a few words: `500 {"error":{"message":"the upstream rejected the request
// (request id: …)"}}` → "500 the upstream rejected the request"; one line, not too long.
function short(s) {
  let t = String(s).trim();
  const json = /^(\d{3})\s+(\{[\s\S]*\})$/.exec(t);
  if (json) {
    try { const j = JSON.parse(json[2]), m = j?.error?.message ?? j?.message; if (typeof m === "string" && m.trim()) t = `${json[1]} ${m.trim()}`; } catch { /* as it is */ }
  }
  return t.replace(/\s*\(request id: [^)]*\)/i, "").split("\n")[0].slice(0, 200);
}

// The message without what the system prompt asked to leave out anyway: a code fence, wrapping quotes.
function clean(text) {
  let t = text.trim();
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1].trim();
  const quoted = /^"([^"]*)"$/.exec(t) ?? /^`([^`]*)`$/.exec(t);
  return quoted ? quoted[1].trim() : t;
}

/** The message in pi's JSON lines (exec's result): `{ text }`, or `{ error }` in a few words.
 *  The text is the last assistant `message_end`'s text parts; errors come from a failed
 *  assistant message, pi's retries (`auto_retry_start`/`auto_retry_end`) or the exit code. */
export function readAnswer({ code, stdout = "", stderr = "" }, timeout = TIMEOUT) {
  let last = null, retry = null, final = null;
  for (const line of stdout.split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.type === "message_end" && e.message?.role === "assistant") last = e.message;
    else if (e?.type === "auto_retry_start" && e.errorMessage) retry = e.errorMessage;
    else if (e?.type === "auto_retry_end" && e.success === false && e.finalError) final = e.finalError;
  }
  const failed = last && (last.stopReason === "error" || last.stopReason === "aborted");
  if (last && !failed) {
    const text = clean((Array.isArray(last.content) ? last.content : []).filter((c) => c?.type === "text").map((c) => c.text).join(""));
    if (text) return { text };
  }
  if (code === 142) return { error: `timed out after ${timeout} s${retry ? ` (${short(retry)})` : ""}` };
  const error = final ?? (failed ? last.errorMessage : null) ?? retry;
  if (error) return { error: short(error) };
  if (code !== 0) return { error: short(stderr.trim().split("\n").pop() || `pi exited with code ${code}`) };
  return { error: "pi answered with no message" };
}

// Terminal colors and other escapes some agents print even into a file.
const plain = (text) => String(text ?? "").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");

// What a failed run says: stopped, not installed, or its last words.
function failure({ code, stderr = "" }, name, timeout) {
  if (code === 142) return { error: `timed out after ${timeout} s` };
  if (code === 127) return { error: `${name} isn't installed here` };
  const last = plain(stderr).trim().split("\n").filter(Boolean).pop();
  return { error: short(last || `${name} exited with code ${code}`) };
}

/** claude -p --output-format json: one JSON object, `result` its answer (`is_error` when it failed). */
export function readClaude(r, timeout = SLOW) {
  let o = null;
  for (const line of String(r.stdout ?? "").trim().split("\n").reverse()) { try { const j = JSON.parse(line); if (j && typeof j === "object") { o = j; break; } } catch { /* not this line */ } }
  if (!o) { try { o = JSON.parse(r.stdout); } catch { o = null; } }
  if (o && o.type === "result") {
    if (o.is_error || (o.subtype && o.subtype !== "success")) return { error: short(o.result || o.subtype || "claude failed") };
    const text = clean(plain(o.result ?? ""));
    if (text) return { text };
  }
  if (r.code !== 0) return failure(r, "claude", timeout);
  const text = o ? "" : clean(plain(r.stdout));
  return text ? { text } : { error: "claude answered with no message" };
}

/** opencode run --format json: JSON events, a line each; the last `text` event's part is its
 *  answer, an `error` event says what failed. */
export function readOpencode(r, timeout = SLOW) {
  let text = null, error = null;
  for (const line of String(r.stdout ?? "").split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.type === "text" && typeof e.part?.text === "string") text = e.part.text;
    else if (e?.type === "error") error = e.error?.data?.message ?? e.error?.message ?? e.error?.name ?? "opencode failed";
  }
  const t = text !== null ? clean(plain(text)) : "";
  if (t) return { text: t };
  if (error) return { error: short(error) };
  if (r.code !== 0) return failure(r, "opencode", timeout);
  return { error: "opencode answered with no message" };
}

/** Plain text out (codex's last message, a custom command's output). */
export function readText(r, name, timeout = SLOW) {
  if (r.code !== 0) return failure(r, name, timeout);
  const text = clean(plain(r.stdout));
  return text ? { text } : { error: `${name} answered with no message` };
}

/** The answer of agent `agent` (exec's result of PEN_SH): `{ text }` or `{ error }`. */
export function readPen(agent, r, cmd = { timeout: agent === "pi" ? TIMEOUT : SLOW, program: agent }) {
  if (agent === "pi") return r.code === 127 ? failure(r, "pi", cmd.timeout) : readAnswer(r, cmd.timeout);
  if (agent === "claude") return readClaude(r, cmd.timeout);
  if (agent === "opencode") return readOpencode(r, cmd.timeout);
  return readText(r, agent === "codex" ? "codex" : cmd.program ?? "the command", cmd.timeout);
}
