// Reading the repositories a scan found only when it's safe (gittrust.js decides: a repository whose
// own git config has only the usual settings is read; else it waits for the person), the trust the
// person gives one with "Read it" (kept in shared "herdr-enhanced.trusted", by machine and folder, as
// its config's fingerprint: a later change asks again), and the line a repository that isn't read
// shows. The repository of the shown folder (the focused terminal's, or the one picked) is always
// read. Every git call the mods make on their own gets SAFE_ARGS (scripts: SAFE_GIT_SH), every count
// or list of a diff DIFF_SAFE.
// Shared: the same file in both mods (shared/, tools/copy-shared.mjs).
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, shared, setShared } from "herdr";
import { SAFE_ARGS, DIFF_SAFE, SAFE_GIT_SH, checkRepo, decide, trust, trustKey } from "./gittrust.js";

export { SAFE_ARGS, DIFF_SAFE, SAFE_GIT_SH };
/** The trusted repositories: trustKey(machine, folder) -> the fingerprint of the config trusted. */
export const TRUSTED = "herdr-enhanced.trusted";
export const NOT_READ = "Not read: its git config has settings beyond the usual ones";

const trusted = () => { const t = shared(TRUSTED); return t && typeof t === "object" && !Array.isArray(t) ? t : {}; };

/** The checks of the repositories found, by machine and folder: checkRepo once each, again once
 *  `ttl` ms have gone by (its config may have changed: the next scan looks again). */
export class RepoChecks {
  constructor(ttl = 30000) { this.ttl = ttl; this.map = new Map(); }
  key(root, on) { return trustKey(on ?? null, root); }
  /** The check of `root` on `on` (cached; `fresh`: look again now). Never throws. */
  async check(root, on = null, { fresh = false } = {}) {
    const k = this.key(root, on), was = this.map.get(k);
    if (was && !fresh && Date.now() - was.at < this.ttl) return was.check;
    const check = await checkRepo({ root, on: on ?? null, exec });
    this.map.set(k, { at: Date.now(), check });
    return check;
  }
  /** The last check of `root`, or null. */
  get(root, on = null) { return this.map.get(this.key(root, on))?.check ?? null; }
  /** "read" or "ask" for `root` (gittrust.js decide with the trusted map): `focused` always reads,
   *  `fetch` only a focused or trusted one. */
  verdict(root, on = null, { focused = false, fetch = false } = {}) {
    return decide(this.get(root, on), trusted(), this.key(root, on), { focused, fetch });
  }
  /** Forgets every check (the next asks again). */
  clear() { this.map.clear(); }
}

/** The mod's checks, for every page and scan in it. */
export const checks = new RepoChecks();

/** "Read it": trusts the repository's config as it is now (from a click: it sets a shared key). */
export function trustRepo(check, root, on = null) {
  if (!check?.fingerprint) return;
  setShared(TRUSTED, trust(trusted(), trustKey(on ?? null, root), check.fingerprint));
}

/** Why a repository isn't read, for a tooltip: the settings beyond the usual ones, or git's error. */
export function notReadWhy(check) {
  if (check?.error) return `git couldn't check it: ${check.error}`;
  const keys = [...new Set((check?.unknown ?? []).map((e) => e.key))];
  return keys.length ? `Its own config has: ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? `, and ${keys.length - 12} more` : ""}` : NOT_READ;
}

/** The line a repository that isn't read shows: NOT_READ (why in its tooltip) and Read it, which
 *  calls `onRead(cx)`; `compact`: "Not read" and the button, for a row. `id` names the elements.
 *  Every press stops there. */
export function notReadBar(t, { id, check, onRead, compact = false }) {
  const stop = (_e, cx) => cx.stop_propagation();
  const button = div().id(`${id}-read-it`).flex_none().h(compact ? 18 : 22).px(compact ? 6 : 8).flex().items_center().rounded(5).border_1().border_color(t.border)
    .text_size(compact ? 10.5 : 11.5).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
    .tooltip("Read it: trust this repository's git config as it is now")
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => { cx.stop_propagation(); onRead(cx); })
    .child("Read it");
  if (compact) {
    return h_flex().id(`${id}-not-read`).flex_none().gap(5).items_center().tooltip(notReadWhy(check))
      .child(div().text_size(10.5).text_color(t.dim).child("Not read")).child(button);
  }
  return h_flex().id(`${id}-not-read`).flex_none().w_full().px(12).py(6).gap(8).items_center().border_b(1).border_color(t.border)
    .tooltip(notReadWhy(check))
    .child(div().flex_1().min_w(0).whitespace_normal().text_size(11.5).text_color(t.dim).child(NOT_READ))
    .child(button);
}
