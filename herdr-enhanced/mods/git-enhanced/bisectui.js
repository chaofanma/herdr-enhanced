// Bisect in the History page (bisect.js has the logic): ⋯ → Bisect: the selected commit is bad… (a
// good one asked), then a bar while it runs: "Testing 1a2b3c4" with Good, Bad, Skip and Reset, and
// once git names it, "The first bad commit is 1a2b3c4" with Show it and Reset. Nothing here reads
// the view: a flow gets `h`, a host (stashui.js), and its facts.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import * as B from "./bisect.js";
import { carryOut } from "./planflow.js";
import { chip, alpha } from "./look.js";
import { readable } from "./ink.js";

const short = (s) => String(s ?? "").slice(0, 7);

/** Where a bisect stands in the repository: parseState, plus `first` (the first bad commit, from
 *  `git bisect log`) while one runs; null when none does. `h`: a runner that reads. */
export async function bisectState(h) {
  const r = await h.sh(B.BISECT_SH);
  const s = r.code === 0 ? B.parseState(r.stdout) : null;
  if (!s?.active) return null;
  const log = await h.git(["bisect", "log"]);
  return { ...s, first: log.code === 0 ? B.parseLog(log.stdout).first : null };
}

/** Start: commit `bad` (the selected one) has the bug; a good one is asked for (`guess`: a tag or a
 *  commit before it), then the plan's question. */
export async function startFlow(h, { bad, guess, version }) {
  const a = await h.ask({ title: `Bisect: ${short(bad.hash)} is bad`, confirm: "Next…", detail: `“${bad.subject}” has the bug. Which commit before it doesn't?`,
    input: { value: guess ?? "", placeholder: "A good commit: a hash, a tag or a branch", required: true } });
  if (!a || !h.same()) return;
  const typed = a.text.trim(), r = await (h.reads ?? h).git(["rev-parse", "-q", "--verify", `${typed}^{commit}`]);
  if (r.code !== 0) { h.note(`“${typed}” isn't a commit here`); return; }
  // The commit rev-parse found, not the words: a name read again later (a branch that moved, a
  // name that starts with "-") could be another commit or an option.
  const good = r.stdout.trim();
  return carryOut(h, B.startPlan({ bad: bad.hash, good: [good] }, { version }), { kind: "bisect", yes: "Start" });
}

/** Good, Bad or Skip for the commit being tested (`term`: the bisect's own words). */
export const markFlow = (h, term) => carryOut(h, B.markPlan(term), { kind: "bisect" });
/** Reset: back to where it started. */
export const resetFlow = (h) => carryOut(h, B.resetPlan(), { kind: "bisect" });

/** The bar: what is tested, or the first bad commit. onMark(term, cx), onReset(cx), onShow(hash, cx). */
export function bisectBar({ t, s, idle, onMark, onReset, onShow }) {
  const found = s.first, tint = alpha(t.accent, 0.1);
  const words = found ? `The first ${s.terms.bad} commit is ${short(found)}` : s.testing ? `Bisecting · testing ${short(s.testing)}` : "Bisecting · mark a commit good or bad";
  // Good's green and Bad's red where they read on the bar's tint, and under the pointer, else the
  // foreground.
  const ink = (c) => readable(t, c, [tint, [tint, t.hover]]);
  return h_flex().id("bisect-bar").h(32).flex_none().px(12).gap(4).items_center().border_b(1).border_color(t.border).bg(tint)
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.foreground).child(words))
    .when(Boolean(found), (e) => e.child(chip(t, "bisect-show", "Show it", { enabled: idle, tip: "Select it in the list", onClick: (_e, cx) => onShow(found, cx) })))
    .when(!found, (e) => e
      .child(chip(t, "bisect-good", s.terms.good === "good" ? "Good" : s.terms.good, { color: ink(t.ansi2), enabled: idle, tip: `git bisect ${s.terms.good}: this commit doesn't have the bug`, onClick: (_e, cx) => onMark(s.terms.good, cx) }))
      .child(chip(t, "bisect-bad", s.terms.bad === "bad" ? "Bad" : s.terms.bad, { color: ink(t.ansi1), enabled: idle, tip: `git bisect ${s.terms.bad}: this commit has the bug`, onClick: (_e, cx) => onMark(s.terms.bad, cx) }))
      .child(chip(t, "bisect-skip", "Skip", { enabled: idle, tip: "git bisect skip: this commit can't be tested", onClick: (_e, cx) => onMark("skip", cx) })))
    .child(chip(t, "bisect-reset", "Reset", { enabled: idle, tip: "git bisect reset: back to where it started", onClick: (_e, cx) => onReset(cx) }));
}
