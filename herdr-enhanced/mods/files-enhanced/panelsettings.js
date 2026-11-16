// The panel's settings, shared by its mods: Files Enhanced and Git Enhanced read them, a settings
// window writes them. Each group lives in one shared key (Herdr keeps it, and every mod
// re-renders when one changes). A missing key or field means its default, and each default is how
// the mods behaved before there were settings. Pure (no herdr import), so it can be tested: a mod
// reads a group with settingsOf(KEYS.files, shared(KEYS.files)). Mods can't import from another
// mod's folder, so this file is copied unchanged into each of them; keep the copies equal.

export const KEYS = {
  openWith: "herdr-enhanced.open-with",
  files: "files-enhanced.settings",
  changes: "git-enhanced.settings",
  agents: "herdr-enhanced.agents",
};

// Related files listed under their parent when nesting is on. `$(base)` is the parent's name
// without its extension; `*` matches any run of characters.
export const NEST = {
  "package.json": ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"],
  "Cargo.toml": ["Cargo.lock"],
  "go.mod": ["go.sum"],
  "pyproject.toml": ["poetry.lock", "uv.lock", "pdm.lock"],
  "Gemfile": ["Gemfile.lock"],
  ".env": [".env.*"],
  "*.ts": ["$(base).js", "$(base).d.ts", "$(base).js.map"],
  "*.tsx": ["$(base).js", "$(base).jsx"],
};

// One of a few values; the first is the default.
const one = (...values) => ({ oneOf: values });

export const SCHEMA = {
  [KEYS.files]: {
    hidden: true,                          // dotfiles are listed
    exclude: [],                           // names or globs never listed (.git always is left out)
    ignored: one("show", "dim", "hide"),   // git-ignored files
    sort: one("name", "type", "modified"),
    foldersFirst: true,
    follow: true,                          // the root follows the focused terminal unless pinned
    freshMinutes: 10,                      // the dot for files changed lately; 0 = no dot
    markdown: one("rendered", "source"),   // how a Markdown preview opens
    wrap: false,                           // the editor wraps long lines
    icons: true,                           // an icon per file type
    compact: true,                         // a chain of single-folder folders in one row
    nesting: false,                        // related files under their parent (NEST)
    nest: NEST,
    repoDepth: 1,                          // folders down to look for more repositories for the git marks (0 = only the root's own)
  },
  [KEYS.changes]: {
    whitespace: false,                     // diffs ignore whitespace (git diff -w)
    context: one(3, 10, "file"),           // lines of context around each change
    codeSize: one(12, 11, 13, 14, "terminal"), // the diffs' text size; "terminal": the terminals' size less one
    autoFetch: 0,                          // minutes between automatic fetches; 0 = never
    askStageAll: true,                     // Commit with nothing staged asks before staging everything
    askAmendPushed: true,                  // amending a commit already pushed asks once more
    commitAgent: one("pi", "claude", "codex", "opencode", "custom"), // who writes the pen's commit message
    commitCommand: [],                     // "custom": argv; {prompt} is replaced, else the prompt goes last
    commitModel: "",                       // the pen's model; "" = props.commit_model, else its default
    template: "",                          // what an empty commit message starts with, e.g. "feat: "
    turns: true,                           // snapshot the repo at each agent turn's start and end
    turnsKeep: 50,                         // turns kept per repo
    repoDepth: 1,                          // folders down to look for more repositories (0 = only the folder's own)
  },
  [KEYS.agents]: {
    name: "pi",                            // what the send dialog starts when the space has no agent
    argv: ["pi"],
    where: one("tab", "right"),            // a new tab, or a pane right of the focused one
  },
  [KEYS.openWith]: {
    items: null,                           // null: DEFAULT_ITEMS (openwith.js); else the person's list
    double: "system",                      // double-click / Shift+Enter on a file: "system" or an item id
    open: "system",                        // the preview bar's Open ↗
    line: "system",                        // Open at a line (search results, diff rows)
  },
};

const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = v => (v === null || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v)));
const strings = v => Array.isArray(v) && v.every(x => typeof x === "string");

function defaultOf(spec) { return spec?.oneOf ? spec.oneOf[0] : clone(spec); }

function valid(spec, v) {
  if (v === undefined) return false;
  if (spec?.oneOf) return spec.oneOf.includes(v);
  if (spec === null) return v === null || Array.isArray(v);
  if (Array.isArray(spec)) return strings(v);
  if (typeof spec === "object") return plain(v) && Object.values(v).every(strings);
  if (typeof spec === "number") return typeof v === "number" && Number.isFinite(v) && v >= 0;
  return typeof v === typeof spec;
}

// A group's settings: what was stored, field by field, where it is valid; the default elsewhere.
export function settingsOf(key, stored) {
  const schema = SCHEMA[key];
  if (!schema) throw new Error(`no settings group ${key}`);
  const s = plain(stored) ? stored : {}, out = {};
  for (const [field, spec] of Object.entries(schema)) out[field] = valid(spec, s[field]) ? clone(s[field]) : defaultOf(spec);
  return out;
}

// What to store for a group: only the fields that differ from their defaults (so a later default
// still reaches what the person never changed); null when nothing differs.
export function storedOf(key, settings) {
  const all = settingsOf(key, settings), out = {};
  for (const [field, spec] of Object.entries(SCHEMA[key])) {
    if (JSON.stringify(all[field]) !== JSON.stringify(defaultOf(spec))) out[field] = all[field];
  }
  return Object.keys(out).length ? out : null;
}

// The values a field may take (for a picker), or null when it isn't one of a few.
export function choicesOf(key, field) { return SCHEMA[key]?.[field]?.oneOf ?? null; }
