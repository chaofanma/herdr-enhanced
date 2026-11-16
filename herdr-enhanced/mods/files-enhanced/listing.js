// What a folder lists and in which order, from the Files settings (files-enhanced.settings, panelsettings.js):
// dotfiles or not, names and globs left out, git-ignored entries shown, dimmed or hidden; sorted by name
// (natural, case-insensitive), type (extension, then name) or modified (newest first), folders first or
// mixed in. Pure: tested in test/files-enhanced/listing.test.mjs.

const escape = s => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

// A glob fragment as RegExp source: "*" and "?" stay in one name, "**" crosses folders ("**/" also
// matches no folder at all), {a,b} is either (globs inside too), [abc] / [!abc] a class.
function source(g) {
  let re = "";
  for (let i = 0; i < g.length;) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      if (g[i + 2] === "/") { re += "(?:.*/)?"; i += 3; } else { re += ".*"; i += 2; }
    } else if (c === "*") { re += "[^/]*"; i++; }
    else if (c === "?") { re += "[^/]"; i++; }
    else if (c === "{" && g.indexOf("}", i) > i) {
      const end = g.indexOf("}", i);
      re += "(?:" + g.slice(i + 1, end).split(",").map(source).join("|") + ")"; i = end + 1;
    } else if (c === "[" && g.indexOf("]", i + 2) > i) {
      const end = g.indexOf("]", i + 2);
      let cls = g.slice(i + 1, end).replace(/\\/g, "\\\\");
      if (cls[0] === "!") cls = "^" + cls.slice(1);
      re += `[${cls}]`; i = end + 1;
    } else { re += escape(c); i++; }
  }
  return re;
}

// A name or glob from settings.exclude as a RegExp over paths relative to the root. Without "/" it
// matches a name at any depth ("dist", "*.log", ".DS_Store"); with one it matches the path from the
// root ("src/gen", "**/build", "docs/*.pdf"). `fold`: ignore case (Windows).
export function globRegex(glob, fold = false) {
  const g = String(glob).trim().replace(/^\.\//, "").replace(/\/+$/, "");
  const anchored = g.includes("/");
  return new RegExp(anchored ? `^${source(g.replace(/^\//, ""))}$` : `(?:^|/)${source(g)}$`, fold ? "i" : "");
}

// A test for settings.exclude: (rel) => true when the path is left out. .git always is (directory()
// never lists it).
export function excluder(globs, fold = false) {
  const res = (globs ?? []).filter(g => typeof g === "string" && g.trim()).map(g => globRegex(g, fold));
  return rel => res.some(re => re.test(rel));
}

// Whether a path or a folder above it is in the set of git-ignored paths (git status --ignored).
export function ignoredIn(set, rel) {
  if (!set?.size) return false;
  for (let p = rel; p; p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") if (set.has(p)) return true;
  return false;
}

// The entries of the folder `prefix` that are listed: dotfiles only with `hidden`, nothing `exclude`d,
// and ignored ones left out when `ignored` is "hide". Each keeps its fields; `ignored: true` marks the
// git-ignored ones that stay (for "dim").
export function shown(entries, prefix, { hidden = true, exclude = [], ignored = "show" } = {}, ignoredSet = null, fold = false) {
  const out = [], left = excluder(exclude, fold);
  for (const e of entries ?? []) {
    if (!hidden && e.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (left(rel)) continue;
    const ig = ignored !== "show" && ignoredIn(ignoredSet, rel);
    if (ig && ignored === "hide") continue;
    out.push(ig ? { ...e, ignored: true } : e);
  }
  return out;
}

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
// "a.TXT" -> "txt"; "" for folders, dotfiles without another dot, and names without one.
export const extensionOf = (name, dir = false) => { const i = name.lastIndexOf("."); return dir || i <= 0 ? "" : name.slice(i + 1).toLowerCase(); };

// The entries in the order settings.sort and settings.foldersFirst say. `times`: name -> ms (modified;
// entries without one go last, by name). Returns a new array.
export function sorted(entries, { sort = "name", foldersFirst = true } = {}, times = null) {
  const byName = (a, b) => natural(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const by = sort === "type"
    ? (a, b) => natural(extensionOf(a.name, a.dir), extensionOf(b.name, b.dir)) || byName(a, b)
    : sort === "modified"
      ? (a, b) => (times?.get(b.name) ?? -Infinity) - (times?.get(a.name) ?? -Infinity) || byName(a, b)
      : byName;
  return [...(entries ?? [])].sort((a, b) => (foldersFirst ? Number(b.dir) - Number(a.dir) : 0) || by(a, b));
}
