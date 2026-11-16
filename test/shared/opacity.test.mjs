// How the pages fade what they draw: a control that waits or can't be pressed (a button that is
// off, busy, or waiting for a git action; a menu item that waits) is faded to 0.7, everywhere; a
// solid button under the pointer to 0.88, as Herdr's own dialogs (its prompt mod). Two looks fade
// to 0.5 on purpose: a file cut in Files (pasting moves it), a file viewed in the Review tab. A hint
// is `muted` or `dim`, never faded (the theme check reads faded text as a control that is off, and
// asks less of it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRS = ["shared", "git-enhanced/mods/git-enhanced", "files-enhanced/mods/files-enhanced", "herdr-enhanced/mods/tabs-enhanced"];
const OFF = 0.7, HOVER = 0.88;
// The looks that fade on purpose: the condition the fade is under, in the line that has it.
const LOOKS = [
  { file: "tree.js", when: "cut?.has(rel)", value: 0.5, what: "a file cut in Files" },
  { file: "filelist.js", when: "viewed === true", value: 0.5, what: "a file viewed in the Review tab" },
];

// Whether the opacity at `at` in `line` is inside a hover style: a `.hover(` before it whose
// parenthesis is still open there.
function inHover(line, at) {
  for (let h = line.lastIndexOf(".hover(", at); h >= 0; h = h > 0 ? line.lastIndexOf(".hover(", h - 1) : -1) {
    let depth = 0, open = true;
    for (let i = h + ".hover".length; i < at; i++) {
      if (line[i] === "(") depth++;
      else if (line[i] === ")" && --depth === 0) { open = false; break; }
    }
    if (open) return true;
  }
  return false;
}

// Every opacity(…) in the mods' code: { where, value (null if computed), arg, hover, line }.
function fades() {
  const out = [], seen = new Set();
  for (const dir of DIRS) for (const file of readdirSync(join(root, dir)).filter((f) => f.endsWith(".js"))) {
    // A shared module's copy in a mod is the same file (tools/check-copies.sh): read it once.
    if (dir !== "shared" && seen.has(file) && readdirSync(join(root, "shared")).includes(file)) continue;
    seen.add(file);
    readFileSync(join(root, dir, file), "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/opacity\(([^()]*)\)/g)) {
        const hover = inHover(line, m.index);
        const value = /^\d*\.?\d+$/.test(m[1].trim()) ? Number(m[1]) : null;
        out.push({ where: `${dir}/${file}:${i + 1}`, file, value, arg: m[1], hover, line });
      }
    });
  }
  return out;
}

test("fading: a control that waits or can't be pressed is 0.7, a solid button under the pointer 0.88, two looks 0.5", () => {
  const all = fades();
  assert.ok(all.length >= 20, `${all.length} fades read`);
  const wrong = [];
  for (const f of all) {
    if (f.hover) {
      // A computed one: each number in it is 0.88 or 1 (no fade).
      const nums = f.value !== null ? [f.value] : [...f.arg.matchAll(/\d*\.?\d+/g)].map((x) => Number(x[0]));
      if (nums.some((n) => n !== HOVER && n !== 1)) wrong.push(`${f.where}: under the pointer ${f.arg}, not ${HOVER}`);
      continue;
    }
    const look = LOOKS.find((l) => l.file === f.file && f.line.includes(l.when));
    if (look) { if (f.value !== look.value) wrong.push(`${f.where}: ${look.what} ${f.arg}, not ${look.value}`); continue; }
    if (f.value !== OFF) wrong.push(`${f.where}: faded to ${f.arg}, not ${OFF} (a control that waits or can't be pressed) nor one of the looks`);
  }
  assert.deepEqual(wrong, []);
  // Each look is still there (a rename would leave it unchecked).
  for (const l of LOOKS) assert.ok(all.some((f) => f.file === l.file && f.line.includes(l.when)), `${l.what}: ${l.file} fades under ${l.when}`);
});

test("fading: an opacity inside a hover style is the look under the pointer, any other a fade (how this test reads them)", () => {
  // The reading above on lines as the code writes them (the first opacity in each).
  const read = (line) => inHover(line, line.indexOf("opacity("));
  assert.equal(read(`.when(on, (e) => e.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(f))`), true);
  assert.equal(read(`.hover((s) => s.bg(t.solid).opacity(0.88))`), true);
  assert.equal(read(`.hover((s) => s.bg(t.hover)).when(!on, (e) => e.opacity(0.7))`), false);
  assert.equal(read(`.when(!on, (e) => e.opacity(0.7)).when(on, (e) => e.hover((s) => s.bg(t.hover)))`), false);
});

test("fading: a hover closed before the opacity, or opened after it, leaves it a fade", () => {
  assert.equal(inHover(`.hover((s) => s.bg(t.hover)).on_click(f)).when(!idle, (e) => e.opacity(0.7))`, 60), false);
  assert.equal(inHover(`x.when(on, (e) => e.hover((s) => s.opacity(0.88)))`, 33), true);
});
