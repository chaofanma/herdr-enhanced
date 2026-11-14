// Reads a rendered tree (the render stubs' elements: `el.$` is { kind, id, calls, children }) in one
// of Herdr's themes (themes.json: the six palettes the Herdr app 0.1.14 ships) and says what would be
// hard to read there, or drawn in a color the theme doesn't have:
// (1) every color handed to an element (text_color, bg, border_color…, inside hover(…) too; a path's
//     fill; an editor's syntax colors) is one of the theme's colors, or one of them at another alpha
//     (look.js alpha()); `allow` lists other colors a caller accepts, at any alpha too (the diff's
//     fixed palettes);
// (2) every piece of text (an element's string children) has enough contrast (WCAG) between its color,
//     the nearest text_color up the tree, and what it is drawn on: the bg colors up the tree,
//     each composited over the one under it (an element's opacity fades all it holds over what is
//     under it), the view's base under them all. What is enough follows the theme's own text: normal
//     text needs min(4.5, 0.95 × foreground/surface), text in `dim` or `muted` (hints, placeholders)
//     min(3, 0.95 × dim/surface), text faded by an opacity (a disabled control) 0.9 × dim/surface.
//     A hover style is read too: the colors it sets, and (when it changes the text's color or
//     fading, or fills opaquely) the text under it.
//     An icon (an svg) is read as text is: drawn in its own text_color, else the nearest one up the
//     tree, as Herdr draws them. It is not words: it needs what dim text needs (WCAG's 3:1 for what
//     isn't text, at most), faded what faded text needs; its report names its file where text's
//     quotes the words.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const THEMES = JSON.parse(readFileSync(join(here, "themes.json"), "utf8")).themes;
export const CLEAR = "#00000000";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const isColor = (v) => typeof v === "string" && HEX.test(v);

/** "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" as [r, g, b, a], each 0..1. */
export function rgba(hex) {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
}
const hex = ([r, g, b, a = 1]) => `#${[r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}${a < 1 ? Math.round(a * 255).toString(16).padStart(2, "0") : ""}`;
/** `top` drawn over `under` (both [r, g, b, a]). */
export function over(top, under) {
  const a = top[3] + under[3] * (1 - top[3]);
  if (a === 0) return [0, 0, 0, 0];
  const mix = (i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
  return [mix(0), mix(1), mix(2), a];
}
const fade = (c, o) => [c[0], c[1], c[2], c[3] * o];
const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** WCAG's contrast ratio between two opaque colors. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** What a theme's text asks for: the ratios its own foreground and dim make on its surface. */
export function needs(colors) {
  const surface = rgba(colors.surface), on = (k) => contrast(over(rgba(colors[k]), surface), surface);
  const fg = on("foreground"), dim = on("dim");
  return { normal: Math.min(4.5, 0.95 * fg), dim: Math.min(3, 0.95 * dim), disabled: 0.9 * dim };
}

const last = (n, m) => { let v; for (const [c, a] of n.calls) if (c === m) v = a; return v; };
const COLOR_CALLS = /color|^bg$|^background$|fill|stroke/;

/** The problems in `tree` drawn in `theme` ({ name, colors } from THEMES): strings, one per element and
 *  pair of colors. `base`: what the view is drawn on (its root's bg, else this; default the theme's
 *  surface). `allow`: more colors (1) accepts. `rows(list)`: a virtual list's rows (else not read).
 *  `style()`: a fresh element for reading hover styles (the stubs' div). `where`: a label. */
export function themeProblems(tree, theme, { base, allow = [], rows, style, where = "" } = {}) {
  const t = theme.colors, need = needs(t), out = new Set();
  const own = new Set(Object.values(t).map((c) => c.toLowerCase()));
  const rgbs = new Set(Object.values(t).map((c) => c.toLowerCase().slice(0, 7)));
  const extra = new Set(allow.map((c) => c.toLowerCase()));
  const dims = new Set([t.dim, t.muted].map((c) => c.toLowerCase().slice(0, 7)));
  const label = (chain) => {
    const ids = chain.map((n) => n.id).filter((x) => x != null);
    return ids.length ? ids.slice(-2).join(" › ") : chain.at(-1)?.kind ?? "?";
  };
  const say = (s) => out.add(`${theme.name}${where ? ` ${where}` : ""}: ${s}`);
  const color = (c, chain, what) => {
    if (!isColor(c)) { if (c != null && typeof c === "string") say(`${label(chain)}: ${what} ${JSON.stringify(c)} is not a color`); return; }
    const k = c.toLowerCase();
    if (k === CLEAR || own.has(k) || extra.has(k) || (k.length === 9 && (rgbs.has(k.slice(0, 7)) || extra.has(k.slice(0, 7))))) return;
    say(`${label(chain)}: ${what} ${c} is not one of the theme's colors${filesWith(c)}`);
  };
  const colorsOf = (n, chain) => {
    for (const [m, a] of n.calls) {
      if (m === "hover" || m === "when") continue;
      for (const v of a) if (typeof v === "string" && v.startsWith("#")) color(v, chain, m);
      if (COLOR_CALLS.test(m) && a[0] && typeof a[0] === "object" && isColor(a[0].solid)) color(a[0].solid, chain, m);
    }
    if (n.kind === "path") color(typeof n.bg === "string" ? n.bg : n.bg?.solid, chain, "path");
  };

  // The layers text is drawn on: from the base up, each { bg } or { group: opacity } (a group ends
  // where the element that opened it ends).
  const paint = (layers, text) => {
    const stack = [{ acc: rgba(baseColor), o: 1 }];
    for (const l of layers) {
      if (l.group != null) stack.push({ acc: [0, 0, 0, 0], o: l.group });
      else if (l.bg) stack.at(-1).acc = over(rgba(l.bg), stack.at(-1).acc);
    }
    if (text) stack.at(-1).acc = over(rgba(text), stack.at(-1).acc);
    while (stack.length > 1) { const g = stack.pop(); stack.at(-1).acc = over(fade(g.acc, g.o), stack.at(-1).acc); }
    return stack[0].acc;
  };
  const read = (n, chain, layers, ink, faded, note = "") => {
    const words = n.children.filter((c) => typeof c === "string" && c.trim() !== "");
    for (const s of words) {
      const textColor = ink ?? t.foreground;
      if (!isColor(textColor)) continue;
      const fg = paint(layers, textColor), bg = paint(layers, null);
      const ratio = contrast(fg, bg);
      const dim = dims.has(textColor.toLowerCase().slice(0, 7)) || rgba(textColor)[3] < 1;
      const kind = faded ? "disabled" : dim ? "dim" : "normal", min = need[kind];
      if (ratio + 1e-9 < min) say(`${label(chain)}${note}: ${textColor}${ink ? "" : " (default)"} on ${hex(bg)}: ${ratio.toFixed(2)} < ${min.toFixed(2)} (${kind}${kind === "disabled" ? ": faded by an opacity" : ""}) ${JSON.stringify(s.length > 24 ? s.slice(0, 23) + "…" : s)}`);
    }
    if (n.kind === "svg") {
      const iconColor = ink ?? t.foreground;
      if (isColor(iconColor)) {
        const bg = paint(layers, null), ratio = contrast(paint(layers, iconColor), bg);
        const dim = dims.has(iconColor.toLowerCase().slice(0, 7)) || rgba(iconColor)[3] < 1;
        const kind = faded ? "disabled" : dim ? "dim" : "icon", min = faded ? need.disabled : need.dim;
        if (ratio + 1e-9 < min) say(`${label(chain)}${note}: ${iconColor}${ink ? "" : " (default)"} on ${hex(bg)}: ${ratio.toFixed(2)} < ${min.toFixed(2)} (${kind}${kind === "disabled" ? ": faded by an opacity" : ""}) ${JSON.stringify(String(n.path ?? "svg").split("/").pop())}`);
      }
    }
  };
  // `hov`: a hover style's recorded element, drawn in place of this element's own bg, text color and
  // opacity (and `tag` marks what is read that way: only text, its colors are checked once).
  const walk = (node, chain, layers, ink, faded, hov = null, tag = "") => {
    const n = node?.$;
    if (!n) return;
    chain = [...chain, n];
    const faded0 = faded;
    if (!tag) colorsOf(n, chain);
    const pick = (m) => (hov && last(hov, m) !== undefined ? last(hov, m) : last(n, m))?.[0];
    const o = pick("opacity"), bg = pick("bg") ?? pick("background");
    let mine = layers;
    if (o != null && o < 1) { mine = [...mine, { group: o }]; faded = true; }
    if (isColor(bg)) mine = [...mine, { bg }];
    const tc = pick("text_color"), inkHere = isColor(tc) ? tc : ink;
    read(n, chain, mine, inkHere, faded, tag);
    // An editor: its syntax colors are text on what it is drawn on (comments in `dim`).
    if (n.kind === "editor" && !tag) for (const [cls, c] of Object.entries(n.state?.opts?.syntax ?? {})) {
      color(c, chain, `syntax.${cls}`);
      if (isColor(c)) read({ children: [cls] }, chain, mine, c, faded, ` (syntax ${cls})`);
    }
    // A hover style: its colors, and this element read again with it.
    if (!tag && style) for (const [m, a] of n.calls) {
      if (m !== "hover" || typeof a[0] !== "function") continue;
      const s = style(); a[0](s); const h = s.$;
      colorsOf(h, [...chain, { id: `${n.id ?? n.kind} (hover)` }]);
      // Only a hover that changes the text's color or its fading, or puts an opaque fill under it, is
      // read: a tint (the theme's own `hover`, at its alpha) shades the row a little while the
      // pointer is on it.
      const hb = last(h, "bg")?.[0] ?? last(h, "background")?.[0];
      if (last(h, "text_color") !== undefined || last(h, "opacity") !== undefined || (isColor(hb) && rgba(hb)[3] === 1)) walk(node, chain.slice(0, -1), layers, ink, faded0, h, " (hover)");
    }
    // A closed popover draws its trigger only.
    const closed = n.kind === "popover" && last(n, "open")?.[0] === false;
    for (const c of n.children) if (!(closed && c === n.contentEl)) walk(c, chain, mine, inkHere, faded, null, tag);
    if (n.kind === "vlist" && rows && !tag) for (const r of rows(n) ?? []) walk(r, chain, mine, inkHere, faded);
  };
  const baseColor = base ?? t.surface;
  walk(tree, [], [], null, false);
  return [...out];
}

// The mod's files that hold a color written out, for a report.
let sources = null;
export function setSources(dir) { sources = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => [f, readFileSync(join(dir, f), "utf8").toLowerCase()]); }
function filesWith(c) {
  if (!sources) return "";
  const hit = sources.filter(([, s]) => s.includes(`"${c.toLowerCase()}"`)).map(([f]) => f);
  return hit.length ? ` (written in ${hit.join(", ")})` : "";
}

/** One test per theme for a mod: `scenes` ({ name, draw: () => tree or its promise, allow }) each
 *  drawn with the stubs' theme() set to the theme's palette (`state.palette`), read by themeProblems:
 *  none may be found. `min`: at least that many states. */
export function themeTests({ test, assert, scenes, state, stubs, rows, min = 1 }) {
  for (const th of THEMES) {
    test(`${th.name} (${th.light ? "light" : "dark"}): every page and state draws in the theme's colors and reads`, async () => {
      const was = state.palette;
      state.palette = th.colors;
      const problems = [];
      try {
        for (const s of scenes()) problems.push(...themeProblems(await s.draw(), th, { allow: s.allow, where: `[${s.name}]`, style: stubs.div, rows }));
      } finally { state.palette = was; }
      assert.ok(scenes().length >= min, `${scenes().length} states drawn`);
      assert.deepEqual(problems, []);
    });
  }
}
