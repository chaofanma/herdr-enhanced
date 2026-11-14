// This mod's name, written once. Herdr's mod.clone rewrites a mod's own "mods/<name>/" paths, so the
// name is read from that path: a clone, or a new folder name plus this line, gives the overlays this mod
// opens of itself, its assets and its shared keys the new name.
const FOLDER = "mods/files-enhanced/";
export const ID = FOLDER.split("/")[1];

// A file of this mod as svg() and image() take it (a path in the app's folder): asset("file.svg").
export const asset = name => FOLDER + name;

// One of this mod's own shared keys: own("pins") is "files-enhanced.pins". The panel's settings groups
// (KEYS.files, KEYS.openWith, KEYS.agents) are read with panelsettings.js's KEYS.
export const own = name => `${ID}.${name}`;

// Which of the panel's two mods this is (shared/installed.js): "files" whatever the folder is called.
export const PART = "files";
