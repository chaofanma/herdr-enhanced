// Patches (patches.js has the logic): Changes' ⋯ → Copy changes as patch ▸ and Apply a patch…, and
// the History page's Copy ›: a commit's message, the commit as a patch or as an email patch. A patch
// travels as text (base64 to another machine), so this works there too. Nothing here reads a view:
// a flow gets `h`, a host (stashui.js), and `copy(text, what)`, which puts text on the clipboard.
import * as P from "./patches.js";
import { plan, step } from "./gitplan.js";
import { carryOut, readPlan } from "./planflow.js";

const EMPTY_TREE = ["hash-object", "-t", "tree", "/dev/null"];

/** Copy changes as patch ▸: what isn't staged, what is, or both. `hasHead`: there is a commit. */
export async function copyChangesFlow(h, { hasHead, copy }) {
  const pick = await h.choose({ title: "Copy changes as patch", width: 300, items: [
    { id: "worktree", label: "What isn't staged", detail: "The index against the files" },
    { id: "index", label: "What is staged", detail: "HEAD against the index" },
    { id: "all", label: "Both", detail: hasHead ? "HEAD against the files" : "Nothing committed yet", disabled: !hasHead },
  ] });
  if (!pick || !h.same()) return;
  const [text] = await readPlan(h, plan([step(P.diffPatchArgs({ what: pick }), "The patch")]));
  if (!text.trim()) { h.note("No changes there to copy (new files count once they are staged)"); return; }
  copy(text, `the patch (${P.patchFiles(text).length} file${P.patchFiles(text).length === 1 ? "" : "s"})`);
}

/** Apply a patch…'s height: 16 px padding above and below, the title 22, the detail's two lines
 *  40, the text box grown to its 10 rows (10 × 18 + 14 = 194), the five choices (four with a second
 *  line, 40 each, one 28), the buttons 32 and the 10 px gaps between the six parts: 548, so a long
 *  patch never pushes the buttons out. */
export const APPLY_HEIGHT = 560;

/** Apply a patch…: the patch (the clipboard's text first), where it goes; then the plan's question
 *  (it names the files). Email patches become commits (git am). */
export async function applyPatchFlow(h, { clip = "" }) {
  const start = P.isMbox(clip) || P.patchFiles(clip).length ? clip : "";
  const a = await h.ask({ title: "Apply a patch", confirm: "Next…", width: 600, height: APPLY_HEIGHT,
    detail: "Paste a patch (git diff) or email patches (git format-patch); the clipboard's patch is already here.",
    input: { value: start, placeholder: "diff --git a/… b/…", multiline: true, required: true },
    choices: { value: "worktree", options: [
      { id: "worktree", label: "To the files", detail: "git apply: all of it or nothing" },
      { id: "both", label: "To the files and the index" },
      { id: "index", label: "To the index only" },
      { id: "reverse", label: "Take it back out of the files", detail: "git apply -R" },
      { id: "3way", label: "With a three-way merge", detail: "To the files and the index; what doesn't apply cleanly waits in conflict" },
    ] } });
  if (!a || !h.same()) return;
  const text = a.text.endsWith("\n") ? a.text : `${a.text}\n`;
  const p = P.isMbox(text) ? P.amPlan(text) : P.applyPlan(text, { target: a.choice === "both" || a.choice === "index" ? a.choice : "worktree", reverse: a.choice === "reverse", threeWay: a.choice === "3way" });
  return carryOut(h, p, { kind: P.isMbox(text) ? "am" : "apply", yes: P.isMbox(text) ? "Make the commits" : "Apply",
    stopped: (said) => `${P.isMbox(text) ? "git am" : "The patch"} stopped on conflicts: ${said.split("\n")[0]}. Resolve them in Changes, then Continue, Skip or Abort.` });
}

/** History's Copy ›: the commit's message, its changes as a patch (against its first parent), or
 *  as an email patch (git am takes it back). `c`: { sha, short, parents }. */
export async function copyCommitFlow(h, { c, copy }) {
  const pick = await h.choose({ title: `Copy ${c.short}`, width: 280, items: [
    { id: "message", label: "Its message" },
    { id: "patch", label: "As a patch", detail: (c.parents?.length ?? 0) > 1 ? "Against its first parent" : "git diff, binary files too" },
    { id: "email", label: "As an email patch", detail: "git format-patch: git am makes the commit again" },
  ] });
  if (!pick || !h.same()) return;
  if (pick === "message") {
    const [text] = await readPlan(h, plan([step(["log", "-1", "--format=%B", c.sha, "--"], "Message")]));
    return copy(text.replace(/\s+$/, ""), "the message");
  }
  if (pick === "email") {
    const [text] = await readPlan(h, plan([step(P.formatPatchArgs([c.sha]), "Email patch")]));
    return copy(text, "the email patch");
  }
  const from = c.parents?.[0] ?? (await readPlan(h, plan([step(EMPTY_TREE, "Empty tree")])))[0].trim();
  const [text] = await readPlan(h, plan([step(P.diffPatchArgs({ what: "range", from, to: c.sha }), "Patch")]));
  return copy(text, "the patch");
}

/** Several commits' Copy as email patches (newest first, as listed). */
export async function copyCommitsFlow(h, { hashes, copy }) {
  const [text] = await readPlan(h, plan([step(P.formatPatchArgs(hashes), "Email patches")]));
  return copy(text, `${hashes.length} email patches`);
}
