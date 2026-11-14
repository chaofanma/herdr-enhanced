// This mod's name, written once. Herdr's mod.clone rewrites a mod's own "mods/<name>/" paths, so the
// name is read from that path: a clone, or a new folder name plus this line, gives the overlays this
// mod opens of itself, its icons, its shared keys and its refs the new name.
const FOLDER = "mods/git-enhanced/";
export const ID = FOLDER.split("/")[1];

// A file of this mod as svg() and image() take it (a path in the app's folder): asset("check.svg").
export const asset = (name) => FOLDER + name;

// Which of the panel's two mods this is (shared/installed.js): "changes" whatever the folder is called.
export const PART = "changes";

// One of this mod's own shared keys: own("lines") is "git-enhanced.lines". The panel's settings
// groups (KEYS.changes, KEYS.agents, KEYS.openWith) are read with panelsettings.js's KEYS.
export const own = (name) => `${ID}.${name}`;

// Every shared key this mod keeps, by what it holds.
export const KEY = {
  layout: own("layout"),   // the diffs' "unified" | "split" (the panel's Split, the tabs' switch)
  lines: own("lines"),     // long lines: "wrap" | "scroll"
  viewed: own("viewed"),   // the Review tab's Viewed files: repo and scope -> { path: hash of its diff }
  repo: own("repo"),       // the repository picked per folder: { "<machine>:<folder>": root }
  turns: own("turns"),     // agent turns, newest first
  changed: own("changed"), // a tick set after an action, so every copy reloads
  drafts: own("drafts"),   // draft review comments: "<machine>:<root>:<scope>" -> comments
  scope: own("scope"),     // the scope per repository: "<machine>:<root>" -> "work", "commit:<sha>", …
  sent: own("sent"),       // a sent review: its drafts go (send.js SENT, the same name)
  show: own("show"),       // another page asks the Changes copies of a repository to show a scope
  reveal: own("reveal"),   // the reveal API (shared/reveal.js): show a file's diff or its history
  tabs: own("tabs"),       // History and Review tabs: tab id -> { kind, root, on, space, from, place }
  titles: own("titles"),   // their names for herdr-t3's pane header (t3-pane reads "<mod>.titles")
  // (tabs.js derives these two from the mod's name it is given: tabplace.js keysOf.)
  historyLayout: own("historyLayout"), // History's arrangement for every copy: "auto" | "side" | "stacked"
  historySplit: own("historySplit"), // History's dragged lines: "panel-v" | "panel-h" | "tab-v" | "tab-h" -> the commits' px, "<that>-info" -> the information's
};

// Where this mod keeps git objects of its own (turn snapshots, discarded changes), as refs.
export const REFS = `refs/${ID}/`;

// The reflog mark of the undos made here (undo.js), and the name snapshots are committed by.
export const UNDO_MARK = `[${ID} undo]`;
export const AUTHOR = ID;

// Where image copies go, in the app's folder (image() shows nothing else).
export const CACHE = `cache/${ID}`;
