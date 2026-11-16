// Paths in the tree: rels are relative to the shown root with "/" ("src/a.js", "" for the root
// itself); fulls are what the machine calls them (root + rel, with the root's own separator).

const backslashed = root => /^[a-z]:\\|^\\\\/i.test(root) || (root.includes("\\") && !root.includes("/"));

// What the machine calls rel under root: root's own separator between the parts.
export function fullOf(root, rel) {
  if (!rel) return root;
  const windows = backslashed(root), head = /[\\/]$/.test(root) ? root.slice(0, -1) : root;
  return windows ? `${head}\\${rel.split("/").join("\\")}` : `${head}/${rel}`;
}

// rel's folder ("" at the top) and its last name.
export const parentOf = rel => rel.slice(0, Math.max(0, rel.lastIndexOf("/")));
export const nameOf = rel => rel.slice(rel.lastIndexOf("/") + 1);

// A full path under root as a rel, or null when it isn't under it.
export function relOf(root, full) {
  const head = root.replace(/[\\/]+$/, "");
  if (full === head) return "";
  const at = full.startsWith(head + "/") || full.startsWith(head + "\\") ? head.length + 1 : -1;
  return at < 0 ? null : full.slice(at).split("\\").join("/");
}

// The folders a rel is in, outermost first: "a/b/c" -> ["a", "a/b"].
export function foldersOf(rel) {
  const out = [];
  for (let i = rel.indexOf("/"); i > 0; i = rel.indexOf("/", i + 1)) out.push(rel.slice(0, i));
  return out;
}
