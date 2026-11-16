// The file clipboard: Cut / Copy keep absolute paths in shared own("clipboard") ({ mode: "cut" | "copy",
// paths, at, on }: `on` the machine, null here), so any copy of this mod can paste them; Paste puts them
// into a folder of the same machine (a cut moves them and empties the clipboard). Duplicate and Move to
// use the same copying (machine.js transfer, named by paste.js): a name already there gets a new one,
// nothing is ever written over, and a folder never goes into itself.
import { shared, setShared, notify } from "herdr";
import { own } from "./id.js";
import { fullOf, parentOf } from "./paths.js";
import { transfer } from "./machine.js";
import { announce } from "./signal.js";
import { plan } from "./paste.js";

export const CLIP = own("clipboard");

// What's on the clipboard (null when nothing is).
export function clipboard() {
  const c = shared(CLIP);
  return c && (c.mode === "cut" || c.mode === "copy") && Array.isArray(c.paths) && c.paths.length ? c : null;
}
// Whether Paste can take it into a tree on machine `on`.
export const pastable = on => Boolean(clipboard()) && (clipboard().on ?? null) === (on ?? null);
export const setClipboard = (mode, paths, on) => setShared(CLIP, { mode, paths, at: Date.now(), on: on ?? null });

const base = full => full.replace(/\/+$/, "").split("/").pop();

// Copies or moves absolute paths into `destRel` (a folder under root), says what didn't work, and has
// the trees reload and select the first that did. Resolves the names given.
async function put(mode, root, on, paths, destRel, verb) {
  const dest = fullOf(root, destRel).replace(/(.)\/+$/, "$1"), steps = plan(mode, paths, dest), go = steps.filter(x => !x.skip);
  const { results, why } = go.length ? await transfer(on, mode, go, dest) : { results: [], why: "" };
  const done = results.filter(r => r.status === "ok");
  const problems = [...steps.filter(x => x.skip && x.skip !== "already there").map(x => x.skip),
    ...results.filter(r => r.status === "gone").map(r => `${base(r.src)} is no longer there`),
    ...results.filter(r => r.status === "fail").map(r => `${base(r.src)}: ${why || "failed"}`)];
  if (problems.length) notify({ title: done.length ? `${verb} ${done.length} of ${steps.length}` : `Couldn't ${verb.toLowerCase()} ${steps.length > 1 ? "them" : "it"}`, body: problems.join("\n"), level: "error" });
  const first = done[0]?.name;
  announce({ on, select: first ? fullOf(dest, first) : null });
  return done.map(r => r.name);
}

// Paste (⌘V, the menu): the clipboard's paths into destRel. After a cut the clipboard empties.
export async function paste(root, on, destRel) {
  const c = clipboard();
  if (!c) return [];
  if ((c.on ?? null) !== (on ?? null)) {
    notify({ title: "Can't paste here", body: "The cut or copied files are on another machine.", level: "error" });
    return [];
  }
  const names = await put(c.mode, root, on, c.paths, destRel, c.mode === "cut" ? "Moved" : "Pasted");
  if (c.mode === "cut" && shared(CLIP)?.at === c.at) setShared(CLIP, null);
  return names;
}

// Duplicate: a copy next to it ("a copy.txt", then "a copy 2.txt").
export const duplicate = (root, on, rel) => put("copy", root, on, [fullOf(root, rel)], parentOf(rel), "Duplicated");

// Move to: rels (under root) into destRel.
export const moveInto = (root, on, rels, destRel) => put("cut", root, on, rels.map(r => fullOf(root, r)), destRel, "Moved");

// The rels under root a cut put on the clipboard (drawn faded until they're pasted), or null.
export function cutRels(root, on) {
  const c = clipboard();
  if (c?.mode !== "cut" || (c.on ?? null) !== (on ?? null) || !root) return null;
  const head = root.replace(/[\\/]+$/, "") + "/";
  return new Set(c.paths.filter(x => x.startsWith(head)).map(x => x.slice(head.length)));
}

