// How the settings window's Files, Git and Agents fields turn what the person types or clicks
// into stored values, and back. Pure, so it can be tested.
import { KEYS, settingsOf } from "./panelsettings.js";
import { splitCommand } from "./shellwords.js";

// "Never list": one name or glob per line; blank lines and repeats are dropped.
export const linesOf = (list) => list.join("\n");
export const listOf = (text) => [...new Set(String(text ?? "").split("\n").map((s) => s.trim()).filter(Boolean))];

// "Nesting rules": the JSON object as the person edits it, one rule a line.
export function nestText(nest) {
  const rules = Object.entries(nest).map(([parent, list]) => `  ${JSON.stringify(parent)}: [${list.map((s) => JSON.stringify(s)).join(", ")}]`);
  return rules.length ? `{\n${rules.join(",\n")}\n}` : "{}";
}

// The rules typed in, { nest } when settingsOf would keep them as they are, else { error } (why they
// weren't saved). An empty box is no rules.
export function nestOf(text) {
  if (!String(text ?? "").trim()) return { nest: {} };
  let v;
  try { v = JSON.parse(text); } catch (e) { return { error: `Not saved: this isn't JSON yet (${String(e?.message ?? e).split("\n")[0]}).` }; }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { error: "Not saved: the rules are one { … } object." };
  for (const [parent, list] of Object.entries(v)) {
    if (!Array.isArray(list) || !list.every((s) => typeof s === "string")) return { error: `Not saved: "${parent}" needs a list of names, like ["${parent}.lock"].` };
  }
  const kept = settingsOf(KEYS.files, { nest: v }).nest;
  return JSON.stringify(kept) === JSON.stringify(v) ? { nest: v } : { error: "Not saved: these rules aren't ones the Files page can use." };
}

// The steps of the window's number fields. A stepper moves to the next step up or down; a value
// stored between two steps moves to the nearest one past it, and one past the ends stays put.
export const STEPS = {
  freshMinutes: [0, 1, 2, 5, 10, 15, 30, 60, 120, 240],
  autoFetch: [0, 1, 2, 5, 10, 15, 30, 60],
  turnsKeep: [10, 20, 50, 100, 200, 500],
  repoDepth: [0, 1, 2, 3, 4],
};

export function stepped(steps, value, by) {
  const next = by > 0 ? steps.find((s) => s > value) : [...steps].reverse().find((s) => s < value);
  return next ?? value;
}

// Whether a stepper's − or + would change the value.
export const canStep = (steps, value, by) => stepped(steps, value, by) !== value;

// How a number field reads: 0 means off (or never) for the minutes ones.
export function minutes(n, zero) {
  if (n === 0) return zero;
  if (n >= 60 && n % 60 === 0) return n === 60 ? "1 hour" : `${n / 60} hours`;
  return n === 1 ? "1 minute" : `${n} minutes`;
}

// What the send dialog can start when a space has no agent: these, or a command of the person's own.
export const AGENT_PRESETS = [
  { name: "pi", argv: ["pi"] },
  { name: "claude", argv: ["claude"] },
  { name: "codex", argv: ["codex"] },
];

// The preset the agents settings are (by the command they run), or null: the person's own.
export const presetOf = (agents) => AGENT_PRESETS.find((p) => JSON.stringify(p.argv) === JSON.stringify(agents.argv)) ?? null;

// What the send dialog runs to start the agents settings' agent ({ argv, where }) with the question
// `text`: a new tab in `space` with the text as its first message, or a terminal right of the focused
// pane with the text as its last argument (terminal.open has no first message; pi, claude and codex
// take one as an argument). [command, args] for run().
export function startCommand({ argv, where }, text, space) {
  if (where === "right") return ["terminal.open", { argv: text ? [...argv, text] : [...argv], place: "right" }];
  return ["tab.new", { ...(space ? { space } : {}), argv: [...argv], ...(text ? { task: text } : {}) }];
}

// Who writes the pen's commit messages (KEYS.changes' commitAgent), in the settings' order, with the
// program each runs; "custom" runs the person's own commitCommand. Git Enhanced's pen
// (commitmsg.js) and the settings window both read this list.
export const COMMIT_AGENTS = [
  { id: "pi", name: "pi", program: "pi" },
  { id: "claude", name: "Claude Code", program: "claude" },
  { id: "codex", name: "Codex", program: "codex" },
  { id: "opencode", name: "OpenCode", program: "opencode" },
  { id: "custom", name: "your command", program: null },
];

// The command typed for "Your own command": { argv } or { error } (then nothing is saved).
export function commitCommandOf(text) {
  const argv = splitCommand(text);
  if (argv === null) return { error: "Not saved: the command has a quote that isn't closed." };
  if (!argv.length) return { error: "Not saved: type the command that writes the message." };
  return { argv };
}

// What "Commit message model" does for the chosen agent (the pen's penModel and penCommand: the
// setting, else the block's commit_model, else pi's default model or the agent's own).
export function commitModelNote(agent) {
  const named = { claude: ["Claude Code", "claude -p"], codex: ["Codex", "codex exec"], opencode: ["OpenCode", "opencode run"] }[agent];
  if (named) return `Given to ${named[1]} as --model. Empty: the panel's default if it has one, else ${named[0]}'s own.`;
  if (agent === "custom") return "Put in place of {model} in your command. Empty: the panel's default if it has one, else nothing.";
  return "Given to pi as --model. Empty: the panel's default if it has one, else pi's own.";
}

// An agent of the person's own from its name and command line: { name, argv } or { error }. Without a
// name it is called after its program.
export function customAgent(name, command) {
  const argv = splitCommand(command);
  if (argv === null) return { error: "The command has a quote that isn't closed." };
  if (!argv.length) return { error: "Type the command that starts it." };
  return { name: String(name ?? "").trim() || argv[0].split("/").pop(), argv };
}
