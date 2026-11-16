// The scope picker's lists for "A commit…" and "Compare with…" (scopes.js), the row a read-only
// scope shows instead of the staging actions, and the History page's "Show in Changes". Each takes
// what it needs as arguments: a git runner, the repository, callbacks, theme colors.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, shared, setShared, layout, run } from "herdr";
import { SCOPE_KEY, SHOW, scopeId, COMMITS, REFS, parseCommits, parseRefList, matching, changesPage } from "./scopes.js";
import { card, choice, lines2, note, field, button, chip } from "./ui.js";
import { ID } from "./id.js";
import { SAFE_ARGS } from "./gittrust.js";

// A row of the scope picker's lists: a title and a line under it.
const SCOPE_ROW = 36;

/** What a commit or ref scope compares (scopes.js readOnlyRange): the commit `target` names, its
 *  first parent (null for a root commit, then `empty`, the empty tree) and its subject. Null when
 *  the target is no commit (any more). `git(args)` runs git in the repository. */
export async function resolveSpan(git, scope, target) {
  if (!target || target.startsWith("-")) return null;
  const r = await git(["rev-parse", "--verify", "-q", `${target}^{commit}`]);
  if (r.code !== 0) return null;
  const sha = r.stdout.trim(), meta = await git(["log", "-1", "--format=%P%x1f%s", sha, "--"]);
  const [parents = "", subject = ""] = meta.code === 0 ? meta.stdout.replace(/\n$/, "").split("\x1f") : [];
  const parent = parents ? parents.split(" ")[0] : null;
  const empty = parent ? null : (await git(["hash-object", "-t", "tree", "/dev/null"])).stdout.trim();
  return { sha, parent, empty, subject, root: !parent };
}

/** The lists behind "A commit…", "Compare with…" and "An agent's turn…": recent commits; branches,
 *  tags and recent commits; or the turns a `source` gives (turns.js turnChoices). Read when one
 *  opens; a box filters them, Enter takes the one left or (commits and refs) what is typed. */
export class ScopeLists {
  constructor() { this.kind = null; this.items = null; this.error = null; this.input = null; this.repo = null; this.pick = null; }

  clearError(cx) { this.error = null; cx.notify(); }

  /** Open `kind` ("commit", "ref" or "turn") for `repo` ({ root, on }); `pick(scope, target, cx)`
   *  takes a row; `source()` gives the rows at once instead of git. From a click (it makes the box
   *  the first time). */
  show(kind, repo, pick, cx, source = null) {
    Object.assign(this, { kind, repo, pick, items: null, error: null });
    if (!this.input) {
      this.input = InputState.new({ placeholder: "" });
      // Typing again clears the last error; Enter takes what is typed.
      this.input.on("change", (_e, cx) => this.clearError(cx));
      this.input.on("submit", (_e, cx) => this.typed(cx));
    }
    this.input.set_value("");
    this.input.focus();
    cx.timer.after(100, () => this.input?.focus());
    if (source) { this.items = source(); cx.notify(); return; }
    const git = (args) => exec("git", [...SAFE_ARGS, ...args], { cwd: repo.root, on: repo.on }).catch(() => ({ code: 1, stdout: "" }));
    cx.spawn(async (cx) => {
      const commits = parseCommits((await git(COMMITS)).stdout).map((c) => ({ ...c, kind: "commit" }));
      const refs = kind === "ref" ? parseRefList((await git(REFS)).stdout) : [];
      if (this.kind === kind && this.repo === repo) this.items = [...refs, ...commits];
      cx.notify();
    });
  }
  close() { this.kind = null; }

  take(row, cx) {
    const kind = this.kind, pick = this.pick;
    this.kind = null;
    // "A commit…": that commit; "Compare with…": the ref's name, or a commit's hash; a turn: its id.
    if (kind === "turn") pick?.("turn", row.id, cx);
    else pick?.(kind === "commit" ? "commit" : "ref", kind === "commit" ? row.sha : row.name ?? row.sha, cx);
  }

  // Enter: the one row left, else what is typed, as a ref or hash git knows.
  typed(cx) {
    const kind = this.kind, repo = this.repo, text = this.input?.value().trim() ?? "", rows = matching(this.items ?? [], text);
    if (!kind || !text) return;
    if (rows.length === 1 && !rows[0].off) { this.take(rows[0], cx); return; }
    if (kind === "turn") return;
    const what = kind === "commit" ? "commit" : "branch, tag or commit";
    if (text.startsWith("-")) { this.error = `"${text}" is no ${what}`; cx.notify(); return; }
    cx.spawn(async (cx) => {
      const r = await exec("git", [...SAFE_ARGS, "rev-parse", "--verify", "-q", `${text}^{commit}`], { cwd: repo.root, on: repo.on }).catch(() => ({ code: 1 }));
      if (this.kind !== kind || this.repo !== repo) return;
      if (r.code === 0) this.take(kind === "commit" ? { sha: r.stdout.trim() } : { name: text }, cx);
      else { this.error = `"${text}" is no ${what} here`; cx.notify(); }
    });
  }

  /** The picker's content while a list is open: back, the box, the rows. */
  element(t) {
    const kind = this.kind, text = this.input?.value() ?? "", rows = matching(this.items ?? [], text).slice(0, 120);
    const colors = { branch: t.ansi4, remote: t.ansi5, tag: t.ansi3 };
    return card(t, 340)
      .child(h_flex().gap(6).px(4).py(2).items_center()
        .child(button(t, "scope-back", "‹ Scopes", (cx) => { this.kind = null; cx.notify(); }, { small: true }))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().child(kind === "commit" ? "One commit, against its first parent" : kind === "turn" ? "What an agent's turn changed" : "The working tree against…")))
      .child(div().px(4).py(2).child(field(t, "scope-filter", Input.new(this.input).w_full().text_size(12).text_color(t.foreground))))
      .child(note(t, this.error ?? (kind === "commit" ? "Type to filter, or paste a hash; Enter takes it" : kind === "turn" ? "Newest first; each against how the repository was when it started" : "Type to filter; Enter takes any branch, tag or hash"), this.error ? t.ansi1 : null))
      // A scroll area needs a height of its own (a max_h alone never scrolls in Herdr): the rows' own
      // (SCOPE_ROW each, a note's 24 when there are none), 290 px at most.
      .child(v_flex().id("scope-rows").h(Math.min(290, rows.length ? rows.length * (SCOPE_ROW + 1) - 1 : 24)).flex_none().overflow_y_scrollbar().gap(1)
        .when(!this.items, (e) => e.child(note(t, "Reading…")))
        .when(Boolean(this.items) && !rows.length, (e) => e.child(note(t, text.trim() ? "Nothing matches; Enter tries it as typed" : "Nothing here")))
        .children(rows.map((r, i) => choice(t, `scope-row-${i}`, { on: (cx) => this.take(r, cx), off: r.off }).h(SCOPE_ROW).flex_none()
          .when(Boolean(colors[r.kind]), (e) => e.child(chip(t, r.kind, colors[r.kind])))
          .child(r.kind === "turn" ? lines2(t, r.title, r.sub) : lines2(t, r.kind === "commit" ? r.subject || r.short : r.name, [r.short, r.age].filter(Boolean).join(" · ")))
          .when(Boolean(r.warn), (e) => e.child(chip(t, "mixed", t.blocked))))));
  }
}

/** The row a read-only scope shows where the staging actions were: `words` (what is shown), `back(cx)`
 *  (to the uncommitted changes), and `extra` elements before that button. */
export function readOnlyBar(t, { words, back, extra = [] }) {
  return h_flex().h(32).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border)
    .child(chip(t, "read-only", t.muted))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(words))
    .children(extra)
    .child(button(t, "scope-uncommitted", "Uncommitted", back, { small: true, tip: "Back to the uncommitted changes" }));
}

/** Show `scope` ("commit" or "ref") of `sha` on the Changes page of that repository: remembered for
 *  it (the scope memory), asked of the copies showing it (`show`), and the stack's Changes page of
 *  mod `mod` brought to the front. `names`: { mod, scope, show } (defaults: this mod's). */
export function showInChanges({ root, on, sha }, scope, names = {}) {
  const key = `${on ?? ""}:${root}`, memory = names.scope ?? SCOPE_KEY, ask = names.show ?? SHOW;
  setShared(memory, { ...(shared(memory) ?? {}), [key]: scopeId(scope, sha) });
  setShared(ask, { key, scope, target: sha, at: Date.now() });
  const page = changesPage(layout(), names.mod ?? ID);
  if (page) run("layout.select", page);
}
