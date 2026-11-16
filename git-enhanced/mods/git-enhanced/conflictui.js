// Conflicts in the Changes page (conflicts.js has the logic): the bar while a merge, rebase,
// cherry-pick, revert or git am waits (Continue, Skip…, Abort…, Ask an agent…), a conflicted file's
// menu (take a side, delete it, start it over, mark it resolved) and its conflict view, where each
// block is resolved by a choice and the file saved. Nothing here reads the view: the UI gets its
// data, colors and callbacks; a flow gets `h`, a host (stashui.js) and its facts.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { readTextFile } from "herdr";
import * as C from "./conflicts.js";
import { atLeast, runPlan, plan, step } from "./gitplan.js";
import { carryOut, readPlan } from "./planflow.js";
import { fileOf } from "./scripts.js";
import { gitSays } from "./stashes.js";
import { chip, alpha } from "./look.js";
import { readable } from "./ink.js";
import { asset } from "./id.js";
import { iconButton, CLOSE } from "./iconbutton.js";
import { expandTabs } from "./wrap.js";

const NAMES = { merge: "Merge", rebase: "Rebase", "cherry-pick": "Cherry-pick", revert: "Revert", am: "git am" };
const plural = (n, word) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);
const short = (h) => String(h ?? "").slice(0, 7);

/** A git am that stopped with no file in conflict and nothing staged: its patch didn't apply at
 *  all (git am leaves no markers then), and --continue would refuse. */
export const patchFailed = (op, conflicts, staged) => op === "am" && !conflicts && !staged;

/** The bar's words: what stopped, where a rebase is, how many files still conflict. `staged`:
 *  something is staged (a git am with nothing staged and no conflicts: its patch didn't apply). */
export function stoppedWords(op, stopped, conflicts, staged = true) {
  const where = (op === "rebase" || op === "am") && stopped?.step ? ` (${op === "am" ? "patch" : "commit"} ${stopped.step.done} of ${stopped.step.total})` : "";
  if (patchFailed(op, conflicts, staged)) return `git am stopped${where}: the patch didn't apply`;
  return conflicts ? `${NAMES[op] ?? op} stopped${where}: ${plural(conflicts, "file")} conflict` : `${NAMES[op] ?? op} stopped${where}: no conflicts left`;
}

/** Why Skip can't run (a merge can't; a cherry-pick or revert needs git 2.23), or null. */
export const skipProblem = (op, version) => C.skipPlan(op, {}, { version }).problem ?? null;

/** The bar while `op` waits: the words, Continue (on once no file conflicts), Skip… (not for a
 *  merge), Abort…, and Ask an agent… (an icon button on a narrow panel, as Ask about diff). */
export function stoppedBar({ t, op, stopped, conflicts, staged = true, idle, busy, narrow, version, onContinue, onSkip, onAbort, onAsk }) {
  const skipWhy = op === "merge" ? null : skipProblem(op, version), failed = patchFailed(op, conflicts, staged);
  const words = stoppedWords(op, stopped, conflicts, staged);
  return h_flex().id("operation-bar").h(30).flex_none().px(12).gap(4).items_center().border_b(1).border_color(t.border).bg(alpha(t.blocked, 0.12))
    .child(div().id(`operation-words-${op}-${stopped?.step ? `${stopped.step.done}of${stopped.step.total}` : "0"}-${conflicts}-${failed ? "failed" : short(stopped?.commit) || "none"}`).flex_1().min_w(0).truncate().text_size(11.5).text_color(readable(t, t.blocked, alpha(t.blocked, 0.12))).tooltip(stopped?.commit ? `Stopped at ${short(stopped.commit)}` : words)
      .child(words))
    .child(chip(t, conflicts ? "conflict-continue-off" : failed ? "conflict-continue-nothing" : "conflict-continue", busy === "continue" ? "Continuing…" : "Continue",
      { enabled: idle && !conflicts && !failed, tip: conflicts ? `Resolve the ${plural(conflicts, "file")} in conflict first` : failed ? "Nothing to go on with: apply the patch's changes by hand and stage them, or Skip it, or Abort" : `git ${op} --continue (no editor: git's message is kept)`, onClick: (_e, cx) => onContinue(cx) }))
    .when(op !== "merge", (e) => e.child(chip(t, skipWhy ? "conflict-skip-off" : "conflict-skip", "Skip…",
      { enabled: idle && !skipWhy, tip: skipWhy ?? `git ${op} --skip: leave this commit out (asks first)`, onClick: (_e, cx) => onSkip(cx) })))
    .child(chip(t, "operation-abort", busy === "abort" ? "Aborting…" : "Abort…", { color: t.ansi1, enabled: idle, tip: `git ${op} --abort (asks first)`, onClick: (_e, cx) => onAbort(cx) }))
    .when(conflicts > 0, (e) => e.child(narrow
      ? iconButton(t, "conflict-ask", asset("message.svg"), (cx) => onAsk(cx), { tip: "Ask the space's agent to resolve the conflicts", label: "Ask an agent to resolve them" })
      : chip(t, "conflict-ask", "Ask an agent…", { tip: "Ask the space's agent to resolve the conflicts", onClick: (_e, cx) => onAsk(cx) })));
}

// ---- The bar's flows

/** Continue: when staged files still hold conflict markers (someone staged them so: git doesn't
 *  look), it asks first. */
export async function continueFlow(h, { op, unresolved, version }) {
  const p = C.continuePlan(op, { unresolved, version });
  if (!p.problem) {
    const [marked, staged] = await readPlan(h, plan([step(C.MARKED_ARGS, "Markers", { ok: [1] }), step(C.STAGED_ARGS, "Staged", { ok: [128] })])).catch(() => ["", ""]);
    const left = C.markedFiles(marked, staged);
    if (left.length && (!(await h.ask({ ...C.markersQuestion(left), confirm: "Continue anyway" })) || !h.same())) return false;
  }
  return carryOut(h, p, { kind: "continue",
    stopped: (said) => `${NAMES[op] ?? op} stopped again: ${said.split("\n").find((l) => /^CONFLICT|could not apply/i.test(l)) ?? said.split("\n")[0]}` });
}
export const skipFlow = (h, { op, stopped, version }) => carryOut(h, C.skipPlan(op, stopped, { version }), { kind: "skip", yes: "Skip",
  stopped: (said) => `${NAMES[op] ?? op} stopped at the next commit: ${said.split("\n").find((l) => /^CONFLICT|could not apply/i.test(l)) ?? said.split("\n")[0]}` });
export const abortFlow = (h, { op }) => carryOut(h, C.abortPlan(op), { kind: "abort", yes: "Abort" });

/** The send dialog's text for "Ask an agent…": where, then conflicts.js agentPrompt. */
export function askText({ where, op, stopped = {}, files = [] }) {
  const merged = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(stopped.message ?? "")?.[1];
  const onto = op === "merge" ? merged ?? (stopped.merging?.[0] ? short(stopped.merging[0]) : null) : stopped.onto ? short(stopped.onto) : null;
  return `In the repository at ${where}:\n\n${C.agentPrompt({ op, files, branch: stopped.rebasing ?? stopped.branch ?? null, onto, commit: stopped.commit ?? null })}`;
}

// ---- A conflicted file's menu

/** The menu's items for conflicted file `f` (conflicts.js parseUnmerged): fileChoices, and Start
 *  over… for a file both sides have. */
export function conflictItems(f, names) {
  const items = C.fileChoices(f, names).map((it) => (it.id === "ours" || it.id === "theirs" || it.id === "delete" ? { ...it, label: `${it.label}…`, danger: true } : it));
  if (f.ours && f.theirs && !f.submodule) items.splice(1, 0, { id: "restart", label: "Start over…", detail: "Its conflict markers back as git wrote them", danger: true });
  return items;
}

/** What a pick in that menu does. `edit()` opens the conflict view. */
export async function conflictPick(h, pick, { f, edit, names = { ours: "ours", theirs: "theirs" } }) {
  if (pick === "edit") return edit();
  if (pick === "ours" || pick === "theirs") return carryOut(h, C.takeSidePlan(f, pick, names), { kind: "resolve", yes: "Take this side" });
  if (pick === "delete") return carryOut(h, C.deletePlan(f), { kind: "resolve", yes: "Delete" });
  if (pick === "restart") return carryOut(h, C.restartPlan(f.path), { kind: "resolve", yes: "Start over" });
  if (pick === "resolved") {
    // Read as text where it can be; a file too big for that (or not UTF-8) is counted by grep there.
    const text = f.ours || f.theirs ? await readTextFile(`${h.root}/${f.path}`, { on: h.on }).catch(() => null) : null;
    const size = f.ours || f.theirs ? C.parseMarkerSize((await (h.reads ?? h).git(C.markerSizeArgs(f.path))).stdout) : 7;
    const left = text !== null ? C.conflictCount(C.parseConflicts(text, size))
      : f.ours || f.theirs ? Number((await (h.reads ?? h).sh(C.COUNT_MARKERS_SH, [String(size), f.path])).stdout.trim()) || 0 : 0;
    if (left && (!(await h.ask({ title: `${f.path} still has ${plural(left, "conflict block")}`, detail: "Its conflict markers would be committed as they are. Mark it resolved anyway?", confirm: "Mark as resolved", danger: true })) || !h.same())) return;
    return carryOut(h, C.resolvedPlan([f.path]), { kind: "resolve" });
  }
}

// ---- The conflict view

export const CHOICE_LABELS = { ours: "Ours", theirs: "Theirs", both: "Both", "both-theirs-first": "Both, theirs first", base: "Base", keep: "Keep" };

/** Reads conflicted file `f` for the view: { path, text, size, segments, choices, error }. */
export async function loadConflict(h, f) {
  const text = await readTextFile(`${h.root}/${f.path}`, { on: h.on }).catch(() => null);
  if (text === null) return { path: f.path, error: "Can't read this file (binary, too large, or unreadable): take a whole side from its menu" };
  if (text.includes("\0")) return { path: f.path, error: "A binary file has no conflict markers: take a whole side from its menu" };
  const size = C.parseMarkerSize((await h.git(C.markerSizeArgs(f.path))).stdout);
  return { path: f.path, text, size, segments: C.parseConflicts(text, size), choices: [], error: null };
}

/** Saves the view's choices into the file (it must still hold what was read) and, with every
 *  block chosen, marks it resolved (git add). */
export async function saveConflict(h, v) {
  // readTextFile turns bytes that aren't UTF-8 into U+FFFD: writing the text back would change them.
  if (v.text.includes("\ufffd")) throw new Error(`${v.path} isn't UTF-8 text (or holds U+FFFD): saving it here would change its bytes. Take a whole side from its menu, or edit it in an editor`);
  const now = await readTextFile(`${h.root}/${v.path}`, { on: h.on }).catch(() => null);
  if (now !== v.text) throw new Error(`${v.path} changed since it was read: open it again`);
  const out = C.resolve(v.segments, v.choices);
  const r = await h.files([fileOf("content", out)], 'cat "$d/content" > "$1"', [v.path]);
  if (r.code !== 0) throw new Error(gitSays(r) || "Couldn't write the file");
  if (!C.unresolved(v.segments, v.choices).length) await runPlan(h, C.resolvedPlan([v.path]));
}

/** "Show the base": the file's markers written again with the base (zdiff3 on git 2.35, else
 *  diff3); what was edited in it is lost, so it asks. */
export const baseFlow = (h, { path, version }) => carryOut(h, C.restartPlan(path, atLeast(version, "2.35") ? "zdiff3" : "diff3"), { kind: "resolve", yes: "Show the base" });

// Save: its id names its state, so its tooltip is never another state's.
function saveChip(t, { canSave, saveWhy, idle, all, none, onSave }) {
  const [id, tip] = !canSave ? ["conflict-save-off", saveWhy] : none ? ["conflict-save-none", "Choose how to resolve a block first"]
    : all ? ["conflict-save-resolved", "Write the choices into the file and mark it resolved (git add)"] : ["conflict-save", "Write the choices made so far; the other blocks keep their markers"];
  return chip(t, id, all ? "Save, resolved" : "Save", { enabled: idle && canSave && !none, color: all && canSave ? t.ansi2 : t.foreground, tip, onClick: (_e, cx) => onSave(cx) });
}

const MOST = 40; // lines of a side shown
// A side's box, tinted with `tone`: its label and notes are `muted` (`dim` doesn't read on the tint).
// Its lines as the diff draws them: a tab is spaces to the next multiple of four columns.
function sideBox(t, { label, text, tone, code }) {
  const lines = String(text).replace(/\r?\n$/, "").split(/\r?\n/), shown = text === "" ? [] : lines.slice(0, MOST);
  return v_flex().flex_none().min_w(0).rounded(5).bg(alpha(tone, 0.12)).border_1().border_color(alpha(tone, 0.35))
    .child(div().px(6).py(2).text_size(10.5).text_color(t.muted).truncate().child(label))
    .children(shown.map((l) => div().h(code.row).flex_none().px(6).min_w(0).truncate().font_family(code.family).text_size(code.size).child(expandTabs(l) || " ")))
    .when(text === "", (e) => e.child(div().px(6).pb(3).text_size(10.5).text_color(t.muted).child("(nothing)")))
    .when(lines.length > MOST, (e) => e.child(div().px(6).pb(3).text_size(10.5).text_color(t.muted).child(`… ${lines.length - MOST} more lines`)));
}

/** The view in place of the diff: a bar (the file, how many blocks are chosen, Show the base…,
 *  Save or Save and mark resolved, ×) over the blocks, each with its sides and the choices.
 *  `names`: conflicts.js sideNames; `code`: { family, size, row }; `canSave`: false with why
 *  (`saveWhy`) where the file can't be written. onChoose(index, choice, cx), onSave(cx),
 *  onBase(cx), onClose(cx). */
export function conflictPane({ t, v, names, code, idle, canSave, saveWhy, onChoose, onSave, onBase, onClose }) {
  const close = iconButton(t, "conflict-close", CLOSE, (cx) => onClose(cx), { tip: "Back to the diff" });
  const pane = v_flex().id("conflict-view").flex_1().min_w(0).min_h(0);
  if (!v || v.error || !v.segments) {
    return pane.child(h_flex().h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).bg(t.raised)
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(v?.path ?? "")).child(close))
      .child(div().p(12).text_size(11.5).text_color(v?.error ? readable(t, t.ansi1) : t.dim).whitespace_normal().child(v?.error ?? "Reading the conflicts…"));
  }
  const blocks = v.segments.filter((s) => s.kind === "conflict"), chosen = blocks.filter((b) => (v.choices[b.index] ?? "keep") !== "keep").length;
  const all = blocks.length > 0 && chosen === blocks.length, hasBase = blocks.some((b) => b.base !== null);
  const bar = h_flex().h(40).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).bg(t.raised)
    .child(v_flex().flex_1().min_w(0).child(div().text_size(12).font_semibold().truncate().child(v.path))
      .child(div().text_size(10.5).text_color(t.muted).truncate().child(blocks.length ? `${chosen} of ${plural(blocks.length, "conflict")} chosen` : "No conflict markers left")))
    .when(!hasBase && blocks.length > 0, (e) => e.child(chip(t, "conflict-base", "Show base…", { enabled: idle, tip: "Write the markers again with the common base between the sides (asks: edits to the file go)", onClick: (_e, cx) => onBase(cx) })))
    .child(saveChip(t, { canSave, saveWhy, idle, all, none: blocks.length > 0 && !chosen, onSave }))
    .child(close);
  const block = (b) => {
    const pick = v.choices[b.index] ?? "keep";
    const options = C.CHOICES.filter((c) => c !== "base" || b.base !== null);
    return v_flex().id(`conflict-${b.index}`).flex_none().mx(8).my(4).p(6).gap(4).rounded(7).border_1().border_color(pick === "keep" ? t.blocked : t.border)
      .child(div().text_size(11).font_semibold().text_color(t.dim).child(`Conflict ${b.index + 1} of ${blocks.length} · line ${b.line + 1}`))
      .child(h_flex().flex_wrap().gap(4).children(options.map((c) => div().id(`conflict-${b.index}-${c}`).h(20).px(7).flex().flex_none().items_center().rounded(10).text_size(11)
        .border_1().border_color(c === pick ? t.accent : t.border).when(c === pick, (e) => e.bg(t.selected))
        .when(idle, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onChoose(b.index, c, cx))).child(CHOICE_LABELS[c]))))
      .child(sideBox(t, { label: `Ours: ${names.ours}${b.labels.ours ? ` · ${b.labels.ours}` : ""}`, text: b.ours, tone: t.ansi4, code }))
      .when(b.base !== null, (e) => e.child(sideBox(t, { label: `Base${b.labels.base ? ` · ${b.labels.base}` : ""}`, text: b.base ?? "", tone: t.dim, code })))
      .child(sideBox(t, { label: `Theirs: ${names.theirs}${b.labels.theirs ? ` · ${b.labels.theirs}` : ""}`, text: b.theirs, tone: t.ansi5, code }));
  };
  const rows = v.segments.map((s) => (s.kind === "conflict" ? block(s)
    : div().flex_none().px(14).py(2).text_size(10.5).text_color(t.dim).child(`⋯ ${plural(s.text.split("\n").length - (s.text.endsWith("\n") ? 1 : 0), "line")} the same on both sides`)));
  return pane.child(bar).child(v_flex().id("conflict-blocks").flex_1().min_h(0).overflow_y_scrollbar().py(4).children(rows));
}
