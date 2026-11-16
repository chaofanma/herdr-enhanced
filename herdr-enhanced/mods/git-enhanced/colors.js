// The diff's colors: one per token class (tokens.js) and the added and removed tints. The `palette`
// prop picks them: "one-dark-pro" (the default), "dark-plus", or "theme" (the Herdr theme's ANSI
// colors, so they follow whatever theme is shown, light or dark). The fixed palettes are made for a
// dark background: in a light theme (its text darker than its surface, whatever the system's
// appearance: a layout may bring its own light theme) the theme's colors are used instead.
// No imports: tested with node (test/git-enhanced/colors.test.mjs).

export const PALETTES = {
  "one-dark-pro": {
    comment: "#7f848e", string: "#98c379", keyword: "#c678dd", number: "#d19a66", type: "#e5c07b",
    function: "#61afef", constant: "#d19a66", tag: "#e06c75", attr: "#d19a66", added: "#98c379", removed: "#e06c75",
  },
  "dark-plus": {
    comment: "#6a9955", string: "#ce9178", keyword: "#569cd6", number: "#b5cea8", type: "#4ec9b0",
    function: "#dcdcaa", constant: "#4fc1ff", tag: "#569cd6", attr: "#9cdcfe", added: "#81b88b", removed: "#c74e39",
  },
};

/** The theme's own colors for each class (`t`: Herdr's theme()). Comments are `muted`: `dim` doesn't
 *  read on the added and removed rows' tints. */
export const themeColors = (t) => ({
  comment: t.muted, string: t.ansi2, keyword: t.ansi5, number: t.ansi3, type: t.ansi6,
  function: t.ansi4, constant: t.ansi3, tag: t.ansi1, attr: t.ansi6, added: t.ansi2, removed: t.ansi1,
});

// A color's relative luminance (WCAG), for #rgb or #rrggbb (an alpha is left out); null otherwise.
function luminance(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(String(color ?? ""));
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const lin = (i) => { const x = parseInt(h.slice(i, i + 2), 16) / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}

/** Whether theme `t` is a light one: its foreground darker than its surface. */
export function isLight(t) {
  const fg = luminance(t?.foreground), bg = luminance(t?.surface);
  return fg !== null && bg !== null && fg < bg;
}

/** The colors for palette `name` (a prop; unknown or missing: the default) in theme `t`; `light`
 *  (the theme's own lightness unless told): the theme's colors. */
export function palette(name, t, light = isLight(t)) {
  if (name === "theme" || light) return themeColors(t);
  return { ...(PALETTES[name] ?? PALETTES["one-dark-pro"]) };
}
