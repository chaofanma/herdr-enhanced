// Images in the diff (the open file is a png, jpg, gif, webp, svg, ico or bmp): its before and
// after side by side with their pixel size and file size. Herdr's image() shows only files in the
// app's folder, so both sides are copied into cache/<mod>/ there, named by their content (a
// changed image is another file), the newest 20 kept. gitops.js imageCopies runs IMAGES_SH.
// No imports: tested with node (test/git-enhanced/images.test.mjs).

export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"]);
/** How many copies the cache keeps. */
export const KEEP_IMAGES = 20;

/** The image extension of `path` (lower case), or null. */
export function imageExt(path) {
  const m = /\.([A-Za-z0-9]+)$/.exec(path ?? "");
  const ext = m ? m[1].toLowerCase() : null;
  return ext && IMAGE_EXT.has(ext) ? ext : null;
}

/** Where a diff's two sides come from, for file `path`: `{ before, after }`, each `{ blob }` (a
 *  git object, `<rev>:<path>` or `:<path>` for the index), `{ file }` (the working tree's), or
 *  null (none: added or deleted). `base` is the diff's: ["--cached"] (staged: HEAD → index), []
 *  (unstaged: index → files) or [ref] (a scope: ref → files); `from`: a rename's old path;
 *  `status`: "A", "D", … ; `fresh`: untracked; `hasHead`: there is a commit. */
export function imageSides({ base = [], path, from = null, status = "M", fresh = false, hasHead = true }) {
  const old = from ?? path;
  if (fresh) return { before: null, after: { file: path } };
  if (base[0] === "--cached") return { before: hasHead && status !== "A" ? { blob: `HEAD:${old}` } : null, after: status === "D" ? null : { blob: `:${path}` } };
  if (base.length === 0) return { before: { blob: `:${old}` }, after: status === "D" ? null : { file: path } };
  return { before: status === "A" ? null : { blob: `${base[0]}:${old}` }, after: status === "D" ? null : { file: path } };
}

/** sh's script that copies the two sides into the cache and says what it got: per side a line
 *  "<name> <bytes> <hex of its first bytes>" or "-". Arguments: the cache folder, the extension,
 *  then kind ("blob", "file" or "-") and spec for before, then for after. */
export const IMAGES_SH = [
  "set -e",
  "dir=$1; ext=$2; shift 2",
  // An absolute folder or nothing: the pruning below must never run anywhere else.
  'case $dir in /?*) ;; *) echo "not a cache folder: $dir" >&2; exit 2;; esac',
  'mkdir -p "$dir"',
  // Enough of the file for its size: a JPEG's frame header can come after big metadata.
  'want=64; case $ext in jpg|jpeg) want=262144;; svg) want=4096;; esac',
  "one() {",
  '  case $1 in',
  '    blob) id=$(git rev-parse -q --verify "$2" 2>/dev/null) || { echo -; return 0; }; n="$id.$ext"',
  '          if [ ! -s "$dir/$n" ]; then git cat-file --filters "$2" > "$dir/$n.part" 2>/dev/null || git cat-file blob "$id" > "$dir/$n.part"; mv -f "$dir/$n.part" "$dir/$n"; fi ;;',
  '    file) [ -f "$2" ] || { echo -; return 0; }; id=$(git hash-object --no-filters -- "$2"); n="$id.$ext"',
  '          if [ ! -s "$dir/$n" ]; then cp -- "$2" "$dir/$n.part"; mv -f "$dir/$n.part" "$dir/$n"; fi ;;',
  "    *) echo -; return 0 ;;",
  "  esac",
  '  touch "$dir/$n"',
  "  printf '%s %s %s\\n' \"$n\" \"$(wc -c < \"$dir/$n\" | tr -d ' ')\" \"$(od -An -v -tx1 -N \"$want\" \"$dir/$n\" | tr -d ' \\n')\"",
  "}",
  'one "$1" "$2"',
  'one "$3" "$4"',
  // Only the copies (an object id and an image extension) count and go.
  `cd -- "$dir" && ls -t | grep -E '^[0-9a-f]{40,64}\\.(png|jpe?g|gif|webp|svg|ico|bmp)$' | tail -n +${KEEP_IMAGES + 1} | while IFS= read -r f; do rm -f -- "$f"; done; exit 0`,
].join("\n");

/** The most bytes a side may have to come from another machine: exec keeps 8 MiB of output, base64
 *  takes 4/3 of the bytes, and there are two sides. */
export const REMOTE_IMAGE = 2.5 * 1024 * 1024;

/** sh's script that prints an image diff's two sides from another machine (where image() can't
 *  reach): per side a line "<name> <bytes>" and its bytes in base64 on the next line, or "-" (no
 *  such side), or "big <bytes>". Named like IMAGES_SH's copies. Arguments: the most bytes, the
 *  extension, then kind ("blob", "file" or "-") and spec for before, then for after. */
export const FETCH_IMAGES_SH = [
  "max=$1; ext=$2; shift 2",
  'if command -v base64 >/dev/null 2>&1; then enc() { base64 | tr -d "\\n"; }; elif command -v openssl >/dev/null 2>&1; then enc() { openssl base64 -A; }; else echo "Sending an image needs base64 or openssl there" >&2; exit 5; fi',
  "one() {",
  '  case $1 in',
  '    blob) id=$(git rev-parse -q --verify "$2" 2>/dev/null) || { echo -; return 0; }; n=$(git cat-file -s "$id" 2>/dev/null) || { echo -; return 0; }',
  '          [ "$n" -le "$max" ] || { echo "big $n"; return 0; }',
  '          printf "%s.%s %s\\n" "$id" "$ext" "$n"; { git cat-file --filters "$2" 2>/dev/null || git cat-file blob "$id"; } | enc; echo ;;',
  '    file) [ -f "$2" ] || { echo -; return 0; }; n=$(wc -c < "$2" | tr -d " ")',
  '          [ "$n" -le "$max" ] || { echo "big $n"; return 0; }',
  '          printf "%s.%s %s\\n" "$(git hash-object --no-filters -- "$2")" "$ext" "$n"; enc < "$2"; echo ;;',
  "    *) echo - ;;",
  "  esac",
  "}",
  'one "$1" "$2"',
  'one "$3" "$4"',
].join("\n");

/** FETCH_IMAGES_SH's output as `[before, after]`, each `{ name, bytes, base64 }`, `{ big: bytes }`
 *  or null. (`bytes` is the object's size; checkout filters may change it: the decoded bytes count.) */
export function parseFetched(stdout = "") {
  const lines = String(stdout).split("\n"), out = [];
  for (let i = 0; out.length < 2 && i < lines.length;) {
    const head = lines[i++] ?? "-";
    if (head === "-" || head === "") { out.push(null); continue; }
    if (head.startsWith("big ")) { out.push({ big: Number(head.slice(4)) || 0 }); continue; }
    const [name, bytes] = head.split(" ");
    out.push({ name, bytes: Number(bytes) || 0, base64: lines[i++] ?? "" });
  }
  while (out.length < 2) out.push(null);
  return out;
}

/** The sh that prunes the copies in a cache folder to the newest KEEP_IMAGES (as IMAGES_SH does). */
export const PRUNE_IMAGES_SH = 'dir=$1; case $dir in /?*) ;; *) echo "not a cache folder: $dir" >&2; exit 2;; esac; ' + IMAGES_SH.split("\n").at(-1);

/** IMAGES_SH's arguments for `sides` (imageSides) into folder `dir`. */
export function imagesArgs(dir, ext, { before, after }) {
  const side = (s) => (s?.blob ? ["blob", s.blob] : s?.file ? ["file", s.file] : ["-", "-"]);
  return [dir, ext, ...side(before), ...side(after)];
}

/** IMAGES_SH's two lines as `[before, after]`, each `{ name, bytes, head }` (`head`: the first
 *  bytes, as numbers) or null. */
export function parseCopies(stdout = "") {
  const lines = stdout.split("\n");
  return [0, 1].map((k) => {
    const [name, bytes, hex = ""] = (lines[k] ?? "-").split(" ");
    if (!name || name === "-") return null;
    const head = [];
    for (let i = 0; i + 1 < hex.length; i += 2) head.push(parseInt(hex.slice(i, i + 2), 16));
    return { name, bytes: Number(bytes) || 0, head };
  });
}

const be16 = (b, i) => (b[i] << 8) | b[i + 1], le16 = (b, i) => b[i] | (b[i + 1] << 8);
const be32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24));
const text = (b, i, n) => String.fromCharCode(...b.slice(i, i + n));

/** An image's pixel size from its first bytes (`head`, numbers) and extension: `{ width, height }`,
 *  or null when they don't tell (or it isn't what its name says). */
export function pixelSize(head, ext) {
  const b = head ?? [];
  if (b.length >= 24 && b[0] === 0x89 && text(b, 1, 3) === "PNG") return { width: be32(b, 16), height: be32(b, 20) };
  if (b.length >= 10 && text(b, 0, 4) === "GIF8") return { width: le16(b, 6), height: le16(b, 8) };
  if (b.length >= 26 && text(b, 0, 2) === "BM") return { width: Math.abs(le32(b, 18)), height: Math.abs(le32(b, 22)) };
  if (b.length >= 30 && text(b, 0, 4) === "RIFF" && text(b, 8, 4) === "WEBP") {
    const chunk = text(b, 12, 4);
    if (chunk === "VP8 ") return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    if (chunk === "VP8L") return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
    if (chunk === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return null;
  }
  if (b.length >= 22 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) {
    // An icon holds several sizes: the largest of the entries read.
    let best = null;
    for (let k = 0, n = le16(b, 4); k < n && 6 + 16 * k + 1 < b.length; k++) {
      const w = b[6 + 16 * k] || 256, h = b[7 + 16 * k] || 256;
      if (!best || w * h > best.width * best.height) best = { width: w, height: h };
    }
    return best;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: be16(b, i + 7), height: be16(b, i + 5) };
      if (marker === 0xda || marker === 0xd9) return null;
      i += 2 + be16(b, i + 2);
    }
    return null;
  }
  if (ext === "svg") return svgSize(text(b, 0, b.length));
  return null;
}

/** An SVG's size from its <svg> tag: width and height in px (or plain numbers), else its viewBox. */
export function svgSize(source = "") {
  const tag = /<svg\b[^>]*>/i.exec(source)?.[0];
  if (!tag) return null;
  const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, "i").exec(tag);
  const w = attr("width"), h = attr("height");
  if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
  const box = /\sviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(tag);
  return box ? { width: Math.round(Number(box[1])), height: Math.round(Number(box[2])) } : null;
}

/** "12.3 KB", "980 B", "1.4 MB". */
export function bytesWords(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** A side's caption: "1200 × 800 · 34.5 KB", or just the file size. */
export const sideWords = (copy) => [copy.size ? `${copy.size.width} × ${copy.size.height}` : null, bytesWords(copy.bytes)].filter(Boolean).join(" · ");

/** What each side is, for the pane's headings: "HEAD" → "index" for a staged diff, "index" →
 *  "working tree" for an unstaged one, the ref (short) → "working tree" for a scope's. */
export function sideLabels(base = []) {
  if (base[0] === "--cached") return { before: "HEAD", after: "index" };
  if (base.length === 0) return { before: "index", after: "working tree" };
  return { before: /^[0-9a-f]{40,}(~1)?$/.test(base[0]) ? base[0].slice(0, 7) + (base[0].endsWith("~1") ? "~1" : "") : base[0], after: "working tree" };
}
