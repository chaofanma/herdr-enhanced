// The History page's commit menu and its dialogs, each an overlay copy of the mod (main.js hands a
// copy whose props hold one of these to CommitOverlay):
//   menu (popup):      props { commitMenu: C }
//   confirm (dialog):  props { commitAsk: { ...C, action: "checkout" | "cherry-pick" | "revert" | "reset", mode } }
//   name (dialog):     props { commitName: { ...C, action: "branch" | "tag" } }
// C = { root, on, sha, short, subject, parents, branch (null: detached), head (HEAD's hash), names,
// refs (the commit's labels), selected (the commit selected on the page), site (the remote's web
// site's name, or null), ask (the id the page waits on) } where names = { mod, changed, scope, show }:
// the mod's folder (for the next overlay) and the shared keys it sets: `changed` after an action
// (the pages reload), `scope` and `show` for Show in Changes (scopepick.js). git runs here. A
// cherry-pick or revert that stops with conflicts shows git's message with Abort.
// The rows marked `page` are the History page's to do (historyacts.js): the menu answers them to
// the page that opened it (awaitMenu), whose task goes on with its own cx.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, props, closeOverlay, openOverlay, theme, notify, setShared } from "herdr";
import { actionArgs, nameArgs, brief, statusCount } from "./gitlog.js";
import { showInChanges } from "./scopepick.js";
import { choice, rule, button, field, dialog, keysFor } from "./ui.js";
import { textCols } from "./wrap.js";
import { readable } from "./ink.js";

export const COMMIT_OVERLAYS = ["commitMenu", "commitAsk", "commitName"];
/** Whether a copy's props make it one of these overlays. */
export const isCommitOverlay = (p) => COMMIT_OVERLAYS.some((k) => p?.[k]);

// The page's answers: menu id → resolve (copies share this module, as question.js's answers).
const waiting = new Map();
let menus = 0;
/** A new menu id and the promise of its answer: a `page` row's id, or null (closed, or a row the
 *  menu did itself). */
export function awaitMenu() {
  const id = `m${Date.now().toString(36)}-${++menus}`;
  return { id, answer: new Promise((resolve) => waiting.set(id, resolve)) };
}
const answerMenu = (id, value) => { const r = waiting.get(id); if (!r) return; waiting.delete(id); r(value); };

// Every row of the menu has a fixed height, so the popup can ask for exactly what it draws: a row
// 26 px, a line between groups 7 (1 and 3 above and below), 1 px between children, 5 around; the
// title its subject's lines (17 px each, two at most) and its hash's (15), 4 above and 3 below.
const ROW = 26, RULE = 7, GAP = 1, PAD = 5, LINE = 17, HASH_LINE = 15, TITLE_PAD = 7;
// What two lines of the subject hold (252 px at 12.5 px), with room for wrapping at words; past
// ONE_LINE columns it may take two.
const TITLE_COLS = 70, ONE_LINE = 32;
const KIND = { branch: "Branch", remote: "Remote branch", tag: "Tag" };
/** The menu's rows for a commit, in git's words: `{ id, label, off?, danger?, page? }`, or "-". */
export function menuItems(c) {
  const on = c.branch ?? "HEAD", here = c.sha === c.head;
  // At most three labels: with every other row the menu stays under ~630 px.
  const labels = (c.refs ?? []).map((r, i) => ({ r, i })).filter(({ r }) => KIND[r.kind]).slice(0, 3);
  return [
    ...(labels.length ? [...labels.map(({ r, i }) => ({ id: `ref-${i}`, label: `${KIND[r.kind]} ${r.name} ›`, page: true })), "-"] : []),
    { id: "branch", label: "Create branch here…" },
    { id: "tag", label: "Create tag here…", page: true },
    { id: "worktree", label: "Create worktree here…", page: true },
    "-",
    { id: "checkout", label: "Checkout commit…", off: here && !c.branch },
    { id: "cherry-pick", label: `Cherry-pick onto ${on}…`, off: here },
    { id: "revert", label: "Revert…" },
    "-",
    // Each a menu of its own (historyacts.js): Soft, Mixed, Hard; Reword, Squash, Drop, the editor.
    { id: "reset", label: `Reset ${on} to here ›`, page: true },
    { id: "rewrite", label: "Interactive rebase ›", page: true },
    "-",
    { id: "show-changes", label: "Show in Changes" },
    { id: "compare", label: "Compare with working tree" },
    ...(c.selected && c.selected !== c.sha ? [{ id: "compare-selected", label: `Compare with ${c.selected.slice(0, 7)}`, page: true }] : []),
    "-",
    ...(c.site ? [{ id: "web", label: `Open on ${c.site}`, page: true }] : []),
    { id: "copy-sha", label: "Copy SHA" },
    { id: "copy", label: "Copy ›", page: true },
  ];
}
const PAGE_ROWS = (c) => new Set(menuItems(c).filter((it) => it?.page).map((it) => it.id));
/** The subject as the title shows it: whole when two lines hold it, else cut at a word with "…". */
export function titleOf(subject) {
  const text = String(subject ?? "");
  if (textCols(text) <= TITLE_COLS) return text;
  let cut = 0, cols = 0;
  for (const ch of text) { const w = textCols(ch); if (cols + w > TITLE_COLS - 1) break; cols += w; cut += ch.length; }
  const word = text.lastIndexOf(" ", cut);
  return `${text.slice(0, word > cut - 16 ? word : cut).trimEnd()}…`;
}
/** The popup's height for those rows and that subject: what the menu draws. */
export function menuHeight(items, subject) {
  const lines = textCols(titleOf(subject)) > ONE_LINE ? 2 : 1;
  const title = TITLE_PAD + lines * LINE + HASH_LINE;
  return 2 * PAD + title + items.reduce((h, it) => h + GAP + (it === "-" ? RULE : ROW), 0);
}
/** A commit's question (a dialog): checkout, cherry-pick, revert, or reset with its mode. */
export const openCommitAsk = (c, action, mode = null) =>
  openOverlay({ mod: c.names?.mod, kind: "dialog", width: 470, height: 236, props: { commitAsk: { ...c, action, mode } } });

const plural = (n, word) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);
const run = (c, args) => exec("git", args, { cwd: c.root, on: c.on });

// What each action says before it runs: [title, what happens, the button].
function ask(c, step, dirty) {
  const on = c.branch ?? "HEAD", merge = (c.parents?.length ?? 0) > 1, against = merge ? ", against its first parent (it is a merge: -m 1)" : "";
  switch (c.action) {
    case "checkout": return [`Check out ${c.short}?`, "HEAD goes to this commit, on no branch (git switch --detach). Git refuses if that would overwrite local changes.", "Check out"];
    case "cherry-pick": return [`Cherry-pick ${c.short} onto ${on}?`, `Its changes are applied on top of ${on} as a new commit${against}. On a conflict it stops: resolve it, or abort.`, "Cherry-pick"];
    case "revert": return [`Revert ${c.short}?`, `A new commit on ${on} takes its changes back${against}. On a conflict it stops: resolve it, or abort.`, "Revert"];
  }
  const lose = dirty === undefined ? "(counting the uncommitted changes…)" : dirty === null ? "every uncommitted change to tracked files is lost" : dirty ? `the uncommitted changes to ${plural(dirty, "file")} are lost` : "nothing uncommitted is lost";
  if (c.mode === "soft") return [`Reset ${on} to ${c.short} (--soft)?`, `The commits after it leave ${on}; what they changed stays staged.`, "Reset"];
  if (c.mode === "mixed") return [`Reset ${on} to ${c.short} (--mixed)?`, `The commits after it leave ${on}; what they changed, and what is staged now, stays in the working tree, unstaged.`, "Reset"];
  return step === 1
    ? [`Reset ${on} to ${c.short} and discard the changes (--hard)?`, `${on}, the index and the working tree all become this commit: ${lose}. Untracked files stay.`, "Continue…"]
    : ["Really reset hard?", `There is no undo here: ${lose}. The commits after ${c.short} stay in the reflog for a while.`, "Reset hard"];
}

const said = (c, name) => ({ branch: `Created branch ${name} at ${c.short}`, tag: `Tagged ${c.short} as ${name}`, checkout: `Checked out ${c.short} (detached)`,
  "cherry-pick": `Cherry-picked ${c.short} onto ${c.branch ?? "HEAD"}`, revert: `Reverted ${c.short}`, reset: `Moved ${c.branch ?? "HEAD"} to ${c.short} (${c.mode})` })[c.action];

export class CommitOverlay {
  init(_props, cx) {
    const p = props() ?? {};
    this.c = p.commitMenu ?? p.commitAsk ?? p.commitName;
    this.kind = p.commitMenu ? "menu" : p.commitAsk ? "ask" : "name";
    this.working = false; this.error = null; this.stopped = null; this.step = 1; this.dirty = undefined;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (this.kind === "name") {
      this.input = InputState.new({ placeholder: this.c.action === "tag" ? "tag name" : "branch name" });
      this.input.on("submit", (_e, cx) => this.go(cx));
      this.input.on("change", (_e, cx) => { if (this.error) { this.error = null; cx.notify(); } });
      this.input.focus();
      cx.timer.after(100, () => this.input.focus());
    }
    // A hard reset says how many files lose their uncommitted changes.
    if (this.kind === "ask" && this.c.mode === "hard") cx.spawn(async (cx) => {
      const r = await run(this.c, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=no"]).catch(() => null);
      this.dirty = r?.code === 0 ? statusCount(r.stdout) : null;
      cx.notify();
    });
  }

  close() { const id = props()?.overlay; if (id) closeOverlay(id); }
  changed() { if (this.c.names?.changed) setShared(this.c.names.changed, Date.now()); }
  // This copy goes: a menu nobody chose from answers the page null.
  gone() { if (this.kind === "menu" && this.c.ask) answerMenu(this.c.ask, null); }

  // A menu row: the page's (answered to it), copy at once, show in Changes, or open the dialog that asks.
  choose(id, cx) {
    const c = this.c, mod = c.names?.mod;
    if (c.ask && PAGE_ROWS(c).has(id)) { answerMenu(c.ask, id); this.close(); return; }
    if (c.ask) answerMenu(c.ask, null);
    if (id === "copy-sha") { cx.write_to_clipboard(c.sha); notify({ title: "Copied the SHA", body: c.short, level: "success", timeout: 2000 }); this.close(); return; }
    this.close();
    if (id === "show-changes" || id === "compare") { showInChanges(c, id === "compare" ? "ref" : "commit", c.names ?? {}); return; }
    if (!mod) return;
    if (id === "branch" || id === "tag") { openOverlay({ mod, kind: "dialog", width: 440, height: 210, props: { commitName: { ...c, action: id } } }); return; }
    openCommitAsk(c, id);
  }

  // The dialog's button: a hard reset asks a second time first; then git.
  go(cx) {
    if (this.kind === "menu" || this.working || this.stopped) return;
    const c = this.c;
    if (c.mode === "hard" && this.step === 1) { this.step = 2; cx.notify(); return; }
    const name = this.input ? this.input.value().trim() : null;
    if (this.input && !name) { this.error = "Type a name first"; cx.notify(); return; }
    this.working = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (name !== null && (await run(c, nameArgs(c.action, name))).code !== 0) { this.error = `"${name}" can't be a ${c.action === "tag" ? "tag" : "branch"} name`; return; }
        const r = await run(c, actionArgs(c.action, { sha: c.sha, name, mode: c.mode, merge: (c.parents?.length ?? 0) > 1 }));
        if (r.code === 0) { this.changed(); notify({ title: said(c, name), level: "success", timeout: 3000 }); this.close(); return; }
        const message = brief(r.stderr || r.stdout) || `git ${c.action} failed`;
        // Stopped on a conflict: the cherry-pick or revert is still going on.
        const head = { "cherry-pick": "CHERRY_PICK_HEAD", revert: "REVERT_HEAD" }[c.action];
        if (head && (await run(c, ["rev-parse", "-q", "--verify", head])).code === 0) { this.stopped = message; this.changed(); }
        else this.error = message;
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.working = false; cx.notify(); }
    });
  }

  // Abort the stopped cherry-pick or revert.
  abort(cx) {
    if (this.working) return;
    const c = this.c;
    this.working = true; cx.notify();
    cx.spawn(async (cx) => {
      const r = await run(c, [c.action, "--abort"]).catch((e) => ({ code: 1, stderr: String(e) }));
      this.working = false; this.changed();
      if (r.code === 0) { notify({ title: `Aborted the ${c.action}`, level: "info", timeout: 3000 }); this.close(); }
      else { this.error = brief(r.stderr || r.stdout) || "abort failed"; cx.notify(); }
    });
  }

  render(cx) {
    const t = theme(), c = this.c;
    // A popup (the menu) is as tall as what it holds, like Herdr's own menus; a dialog fills its frame.
    const root = (this.kind === "menu" ? v_flex().w_full() : v_flex().size_full()).id("commit-overlay").min_h(0).bg(t.popover).text_color(t.foreground).track_focus(this.handle)
      .on_key_down(keysFor({ escape: () => this.close(), ...(this.kind === "ask" ? { enter: (cx) => (this.stopped ? null : this.go(cx)) } : {}) }));
    if (this.kind === "menu") return this.menu(root, t);
    const cancel = button(t, "commit-cancel", "Cancel", () => this.close());
    const failed = this.error ? div().text_size(11.5).text_color(readable(t, t.ansi1, t.popover)).whitespace_normal().child(this.error) : null;
    if (this.kind === "name") {
      const tag = c.action === "tag";
      return dialog(t, root, {
        title: tag ? `Tag ${c.short}` : `New branch at ${c.short}`, subject: c.subject,
        body: v_flex().gap(6).child(field(t, "commit-name", Input.new(this.input).w_full().text_size(12.5).text_color(t.foreground)))
          .child(failed ?? div().text_size(11).text_color(t.muted).child(tag ? "A lightweight tag. Enter makes it." : "Enter makes it; you stay on the branch you are on.")),
        buttons: [cancel, button(t, "commit-confirm", this.working ? "Working…" : tag ? "Tag" : "Create branch", (cx) => this.go(cx), { kind: "primary", busy: this.working })],
      });
    }
    if (this.stopped) {
      return dialog(t, root, {
        title: `The ${c.action} of ${c.short} stopped`, subject: c.subject, danger: true,
        // The body fills the dialog (flex_1), so what git said, flex_1 in it, has what's left: in a
        // body as tall as its content it came out 0 px tall.
        body: v_flex().flex_1().min_h(0).gap(6)
          .child(div().whitespace_normal().child(`It conflicts with ${c.branch ?? "HEAD"}. Resolve the conflicts in Changes and commit (git ${c.action} --continue), or abort to go back.`))
          .child(div().id("commit-stopped").flex_1().min_h(0).overflow_y_scrollbar().px(8).py(6).rounded(6).bg(t.raised).text_size(11).text_color(t.muted).whitespace_normal().child(this.stopped))
          .when(Boolean(failed), (e) => e.child(failed)),
        buttons: [button(t, "commit-later", "Resolve later", () => this.close()), button(t, "commit-abort", this.working ? "Aborting…" : `Abort the ${c.action}`, (cx) => this.abort(cx), { kind: "danger", busy: this.working })],
      });
    }
    const [title, what, yes] = ask(c, this.step, this.dirty), risky = c.action === "reset";
    return dialog(t, root, {
      title, subject: `${c.short} · ${c.subject}`, danger: c.mode === "hard",
      body: v_flex().gap(6).child(div().whitespace_normal().child(what)).when(Boolean(failed), (e) => e.child(failed)),
      buttons: [cancel, button(t, "commit-confirm", this.working ? "Working…" : yes, (cx) => this.go(cx), { kind: risky ? "danger" : "primary", busy: this.working })],
    });
  }

  menu(root, t) {
    const c = this.c;
    // Not a scroll area: Herdr sizes a popup to its content (up to the height asked for), and a
    // scroll area reports no content height, so the menu would show as a thin line. menuHeight() fits it.
    // Each child a fixed height (menuHeight adds them up): the subject two lines at most, the rows
    // one line, their labels truncating.
    return root.p(PAD).gap(GAP)
      .child(v_flex().flex_none().px(9).pt(4).pb(TITLE_PAD - 4)
        .child(div().text_size(12.5).line_height(`${LINE}px`).font_semibold().whitespace_normal().max_h(2 * LINE).overflow_hidden().child(titleOf(c.subject) || c.short))
        .child(div().text_size(10.5).line_height(`${HASH_LINE}px`).text_color(t.muted).truncate().child(`${c.short}${c.branch ? ` · on ${c.branch}` : " · detached HEAD"}`)))
      .children(menuItems(c).map((it) => (it === "-" ? rule(t)
        : choice(t, `commit-${it.id}`, { on: (cx) => this.choose(it.id, cx), off: it.off, danger: it.danger }).h(ROW).flex_none()
          .child(div().min_w(0).truncate().child(it.label)))));
  }
}
