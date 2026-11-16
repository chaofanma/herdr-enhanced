// Names for copies dropped into a folder that already has the name, as Finder makes them:
// "a.txt" -> "a 2.txt", then "a 3.txt"...; a folder, a dotfile or a name without an extension gets the
// number at the end ("photos 2", ".env 2", "Makefile 2"). The extension is the last ".part" (no spaces
// in it), with a ".tar" before it kept too: "x.tar.gz" -> "x 2.tar.gz". A number already in the name
// is left alone: another "a 2.txt" becomes "a 2 2.txt". Pure: tested in test/files-enhanced/names.test.mjs.

// [stem, ext] with stem + ext === name.
export function splitName(name, dir = false) {
  const m = dir ? null : /^(.+?)((?:\.tar)?\.[^.\s]+)$/i.exec(name);
  return m ? [m[1], m[2]] : [name, ""];
}

// The nth name: n < 2 is the name itself.
export const numbered = (stem, ext, n) => n < 2 ? stem + ext : `${stem} ${n}${ext}`;

// The first name `taken(name)` says is free.
export function freeName(name, taken, dir = false) {
  const [stem, ext] = splitName(name, dir);
  for (let n = 1; n < 100000; n++) {
    const next = numbered(stem, ext, n);
    if (!taken(next)) return next;
  }
  return null;
}

// The archive Compress makes in a folder: "<name>.zip" for one item (Finder's), "Archive.zip" for
// several; numbered when taken ("Archive 2.zip", "photos 2.zip").
export function archiveName(names, taken) {
  return freeName(names.length === 1 ? `${names[0]}.zip` : "Archive.zip", taken);
}

// Adapted from microsoft/vscode src/vs/workbench/contrib/files/browser/fileActions.ts incrementFileName,
// "simple" naming (MIT): "a" -> "a copy" -> "a copy 2" -> "a copy 3"; a name already ending in " copy"
// or " copy N" counts on from it ("a copy 5" -> "a copy 6"). As [stem, n]: the first candidate is
// numbered(stem, ext, n), the next ones numbered(stem, ext, n + 1)…, as freeName counts.
export function copyStart(stem) {
  const m = /^(.+ copy)( \d+)?$/.exec(stem);
  if (!m) return [`${stem} copy`, 1];
  const n = m[2] ? parseInt(m[2], 10) : 1;
  return [m[1], n === 0 ? 1 : n + 1];
}

// The name Duplicate (or a copy pasted where it came from) gives: "a copy.txt", then "a copy 2.txt"…
// The extension is splitName's (".tar.gz" together; none for folders).
export function copyName(name, taken, dir = false) {
  const [stem, ext] = splitName(name, dir), [cstem, first] = copyStart(stem);
  for (let n = first; n < first + 100000; n++) {
    const next = numbered(cstem, ext, n);
    if (!taken(next)) return next;
  }
  return null;
}
