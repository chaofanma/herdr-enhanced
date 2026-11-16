// A file as it was (History: a commit's file menu, "Open this version", "Browse the files at this
// commit"; the diff's "Show the file at…"): a file's bytes at a revision (or in the index, or one
// side of a conflict), its size and kind, a tree's entries at a revision, and whether a path is
// there at all.
// No Herdr imports: tested with node (test/git-enhanced/fileat.test.mjs).
import { nulFields } from "./gitplan.js";

/** What names `path` (from the repository's top) in `rev`: "<rev>:<path>", git's name for it
 *  there, the path taken as it is (no pathspec, no globs). `rev` "" is the index; `stage` 1, 2 or
 *  3 is a conflict's base, ours or theirs in the index. */
export function spec(rev, path, { stage = null } = {}) {
  const p = String(path ?? "").replace(/^\/+/, "");
  return stage ? `:${stage}:${p}` : `${rev ?? ""}:${p}`;
}

/** git's arguments for the file's bytes (`textconv`: through the file's textconv driver, as a
 *  person reads it, e.g. a document's text). exec gives at most 8 MiB back: ask for the size first. */
export const showArgs = (rev, path, { stage = null, textconv = false } = {}) => ["cat-file", textconv ? "--textconv" : "blob", spec(rev, path, { stage })];
/** …for its size in bytes, and its kind ("blob", "tree", "commit" for a submodule). */
export const sizeArgs = (rev, path, opts = {}) => ["cat-file", "-s", spec(rev, path, opts)];
export const typeArgs = (rev, path, opts = {}) => ["cat-file", "-t", spec(rev, path, opts)];
/** …that exit 0 (and print its object's hash) when `path` is in `rev`, 1 when it isn't, quietly
 *  (a revision that isn't one is also 1). */
export const existsArgs = (rev, path, opts = {}) => ["rev-parse", "-q", "--verify", spec(rev, path, opts)];

/** The most bytes the pages show of a file's version (exec's limit is 8 MiB). */
export const MAX_SHOW = 4 * 1024 * 1024;

/** Whether text looks binary, as git decides it: a NUL in its first 8000 characters. */
export const looksBinary = (text) => String(text ?? "").slice(0, 8000).includes("\0");

/** git's arguments that list the entries of folder `dir` ("" for the top) in `rev`, with their
 *  sizes, NUL separated. */
export const treeArgs = (rev, dir = "") => ["ls-tree", "-z", "--long", dir ? spec(rev, String(dir).replace(/\/+$/, "")) : `${rev}^{tree}`];

const KIND = { "100644": "file", "100755": "exec", "120000": "link", "040000": "dir", "160000": "submodule" };

/** treeArgs' output as [{ name, path, mode, type, sha, size, kind }]: `path` from the top
 *  (`dir` and the name), `size` in bytes (null for a folder or a submodule), `kind` "file",
 *  "exec", "link", "dir" or "submodule"; folders first, then by name, as a file list shows them. */
export function parseTree(stdout, dir = "") {
  const prefix = dir ? `${String(dir).replace(/\/+$/, "")}/` : "", out = [];
  for (const e of nulFields(stdout)) {
    const m = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40,64}) +(-|\d+)\t([\s\S]+)$/.exec(e.replace(/^\n/, ""));
    if (!m) continue;
    const [, mode, type, sha, size, name] = m;
    out.push({ name, path: prefix + name, mode, type, sha, size: size === "-" ? null : Number(size), kind: KIND[mode] ?? (type === "tree" ? "dir" : "file") });
  }
  return out.sort((a, b) => (a.kind === "dir") !== (b.kind === "dir") ? (a.kind === "dir" ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
