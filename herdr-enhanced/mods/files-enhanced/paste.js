// What a paste, a duplicate or a move does with each path, and the names it gives: pure, tested in
// test/files-enhanced/paste.test.mjs. The copying itself is TRANSFER below, run by machine.js transfer() here or on
// the space's machine: a shell loop that names each item the way these say and never writes over anything.
import { splitName, copyStart } from "./names.js";

const dirOf = p => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) || "/" : "");
export const inside = (path, folder) => path === folder || path.startsWith(folder.endsWith("/") ? folder : folder + "/");

// For each absolute path pasted into the absolute folder `dest`: { src, copy } (copy: a copy where it
// came from, so "a copy.txt" rather than "a 2.txt"), or { src, skip } with why: a folder can't go into
// itself (nor a copy of it: it would copy forever), and cutting into its own folder is nothing to do.
// Adapted from microsoft/vscode src/vs/workbench/contrib/files/browser/fileActions.ts pasteFileHandler
// (MIT): "File to paste is an ancestor of the destination folder".
export function plan(mode, paths, dest) {
  return paths.map(src => {
    if (inside(dest, src)) return { src, skip: `${src.split("/").pop()} can't go into itself` };
    if (mode === "cut" && dirOf(src) === dest) return { src, skip: "already there" };
    return { src, copy: mode === "copy" && dirOf(src) === dest };
  });
}

// The shell's naming arguments for one item (see TRANSFER): the stem, the first number
// and the extension for a file, and the stem and first number for a folder (whose dots stay).
export function nameArgs(name, copy) {
  const [stem, ext] = splitName(name), file = copy ? copyStart(stem) : [stem, 1], dir = copy ? copyStart(name) : [name, 1];
  return [file[0], String(file[1]), ext, dir[0], String(dir[1])];
}

// The shell loop of a paste, duplicate or move: sh -c TRANSFER files <cut|copy> <dest> and six arguments
// per item, <path> and nameArgs(). For each it prints "ok\0<name>\0", "gone\0<path>\0" (not there any
// more) or "fail\0<path>\0" (cp or mv said why on stderr). The name counts on while anything has it, so
// nothing is written over. Runs here or on the space's machine.
export const TRANSFER = 'mode=$1 d=$2; shift 2; while [ $# -ge 6 ]; do s=$1 stem=$2 n=$3 ext=$4; if [ -d "$s" ] && [ ! -L "$s" ]; then stem=$5 n=$6 ext=; fi; shift 6; '
  + 'if [ ! -e "$s" ] && [ ! -L "$s" ]; then printf "gone\\0%s\\0" "$s"; continue; fi; '
  + 'if [ "$n" -lt 2 ]; then name=$stem$ext; else name="$stem $n$ext"; fi; '
  + 'while [ -e "$d/$name" ] || [ -L "$d/$name" ]; do n=$((n+1)); name="$stem $n$ext"; done; '
  + 'if [ "$mode" = cut ]; then mv -- "$s" "$d/$name"; else cp -R -- "$s" "$d/$name"; fi && printf "ok\\0%s\\0" "$name" || printf "fail\\0%s\\0" "$s"; done';

// What TRANSFER printed: [{ status: "ok" | "gone" | "fail", value: name or path }].
export function parseTransfer(stdout) {
  const f = String(stdout ?? "").split("\0"), out = [];
  for (let i = 0; i + 1 < f.length; i += 2) if (f[i]) out.push({ status: f[i], value: f[i + 1] });
  return out;
}
