// The font the diffs, messages and file names in code are drawn in: the terminals' font (settings),
// at the size the settings' Code size says (12 by default; "terminal": the terminals' size less
// one, 9 at least), unless the block's props say a size (font_size).
import { props, settings, shared } from "herdr";
import { KEYS, settingsOf } from "./panelsettings.js";

const FALLBACK = "JetBrains Mono";

// settings() names the terminals' font `font_family` (settings.json and a layout write it `font`).
export function codeFont() {
  const font = settings()?.font_family;
  return typeof font === "string" && font !== "" ? font : FALLBACK;
}

export function codeSize() {
  const own = Number(props()?.font_size);
  if (own) return own;
  const size = settingsOf(KEYS.changes, shared(KEYS.changes)).codeSize;
  if (typeof size === "number") return size;
  const terminal = Number(settings()?.font_size) || 14;
  return Math.max(9, terminal - 1);
}
