// Token colors for diff lines: a small scanner per family of languages, chosen by the file's name.
// A line becomes spans { text, cls }, cls one of "" (plain), "comment", "string", "keyword",
// "number", "type", "function", "constant", "tag", "attr". What carries over to the next line is
// the state: inside a block comment or a multi-line string, and how it ends. Good enough for
// reading a diff: no grammar, no nesting, no regex literals.
// No imports: tested with node (test/git-enhanced/tokens.test.mjs).

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const C_LIKE = "if else for while do switch case default break continue return goto sizeof typedef struct union enum static extern const volatile inline register auto signed unsigned void char short int long float double bool true false NULL";
const KEYWORDS = {
  js: "async await break case catch class const continue debugger default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of package private protected public readonly return set static super switch this throw try type typeof var void while with yield as declare namespace module abstract keyof satisfies infer is",
  rust: "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while macro_rules union",
  python: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case print",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
  c: `${C_LIKE} class namespace template typename public private protected virtual override final new delete this throw try catch using operator friend explicit constexpr nullptr noexcept static_cast dynamic_cast reinterpret_cast const_cast decltype @interface @implementation @end @property @synthesize self super id`,
  jvm: "abstract annotation as assert break by case catch class companion const constructor continue data default defer deinit do else enum extends extension final finally for fun func guard if implements import in init inline inner interface internal is lateinit let match new object open operator out override package private protected public record return sealed self static struct super switch synchronized throw throws trait try typealias val var when where while with yield async await using namespace readonly ref get set lazy mutating protocol subscript fallthrough repeat",
  ruby: "alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require require_relative attr_accessor attr_reader attr_writer include extend private protected public lambda proc",
  php: "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield",
  shell: "if then else elif fi case esac for while until do done in function select time return break continue exit export local readonly declare typeset unset shift source alias set trap eval exec test echo printf read cd",
  sql: "select from where and or not insert into values update set delete create table view index drop alter add column primary key foreign references join left right inner outer full cross on as group by order having limit offset union all distinct case when then else end null is in exists between like default constraint unique check returning with begin commit rollback transaction asc desc",
  css: "important media import supports keyframes font-face charset namespace page layer container from to and not only",
};
const CONSTANTS = words("true false null undefined None True False nil NaN Infinity TRUE FALSE NULL");

// A family: comment markers, string delimiters (longest first; `multi` ones may span lines, `raw`
// ones take no escapes), keywords, and what else to look for.
const FAMILIES = {
  js: { line: ["//"], block: [["/*", "*/"]], strings: ["`", '"', "'"], multi: ["`"], keywords: "js", calls: true, types: true },
  rust: { line: ["//"], block: [["/*", "*/"]], strings: ['"'], keywords: "rust", calls: true, types: true },
  python: { line: ["#"], block: [], strings: ['"""', "'''", '"', "'"], multi: ['"""', "'''"], keywords: "python", calls: true, types: true },
  go: { line: ["//"], block: [["/*", "*/"]], strings: ["`", '"', "'"], multi: ["`"], raw: ["`"], keywords: "go", calls: true, types: true },
  c: { line: ["//"], block: [["/*", "*/"]], strings: ['"', "'"], keywords: "c", calls: true, types: true },
  jvm: { line: ["//"], block: [["/*", "*/"]], strings: ['"""', '"', "'"], multi: ['"""'], raw: ['"""'], keywords: "jvm", calls: true, types: true },
  ruby: { line: ["#"], block: [], strings: ['"', "'"], keywords: "ruby", calls: false, types: true },
  php: { line: ["//", "#"], block: [["/*", "*/"]], strings: ['"', "'"], keywords: "php", calls: true, types: true },
  shell: { line: ["#"], block: [], strings: ['"', "'"], raw: ["'"], keywords: "shell", calls: false, types: false },
  sql: { line: ["--"], block: [["/*", "*/"]], strings: ["'", '"'], keywords: "sql", calls: true, types: false, nocase: true },
  css: { line: [], block: [["/*", "*/"]], strings: ['"', "'"], keywords: "css", calls: true, types: false, css: true },
  scss: { line: ["//"], block: [["/*", "*/"]], strings: ['"', "'"], keywords: "css", calls: true, types: false, css: true },
  markup: { line: [], block: [["<!--", "-->"]], strings: ['"', "'"], keywords: null, markup: true },
  yaml: { line: ["#"], block: [], strings: ['"', "'"], keywords: null, keys: true },
  toml: { line: ["#"], block: [], strings: ['"""', "'''", '"', "'"], multi: ['"""', "'''"], keywords: null, keys: true },
  json: { line: ["//"], block: [["/*", "*/"]], strings: ['"'], keywords: null, keys: true },
};
const SETS = Object.fromEntries(Object.entries(KEYWORDS).map(([k, v]) => [k, words(v)]));

const BY_EXT = {
  js: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", tsx: "js", mts: "js", cts: "js",
  rs: "rust", py: "python", pyi: "python", pyw: "python", go: "go",
  c: "c", h: "c", cc: "c", cpp: "c", cxx: "c", hpp: "c", hh: "c", hxx: "c", m: "c", mm: "c", ino: "c",
  java: "jvm", kt: "jvm", kts: "jvm", cs: "jvm", scala: "jvm", sc: "jvm", swift: "jvm", dart: "jvm", groovy: "jvm", gradle: "jvm",
  rb: "ruby", rake: "ruby", gemspec: "ruby", php: "php",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell", ksh: "shell", env: "shell",
  sql: "sql", css: "css", scss: "scss", sass: "scss", less: "scss",
  html: "markup", htm: "markup", xhtml: "markup", xml: "markup", svg: "markup", vue: "markup", svelte: "markup", plist: "markup", xaml: "markup",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "toml", cfg: "toml", conf: "toml",
  json: "json", jsonc: "json", json5: "json", geojson: "json", lock: "json",
};
const BY_NAME = { makefile: "shell", dockerfile: "shell", gemfile: "ruby", rakefile: "ruby", podfile: "ruby", ".bashrc": "shell", ".zshrc": "shell", ".profile": "shell", ".gitignore": "shell", ".env": "shell", "cargo.lock": "toml", "package-lock.json": "json" };

/** The family a file's name says, or null (plain text). */
export function languageOf(file) {
  const name = String(file ?? "").split("/").pop().toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith("dockerfile") || name.startsWith("makefile")) return "shell";
  const dot = name.lastIndexOf(".");
  return dot > 0 || (dot === 0 && name.length > 1) ? BY_EXT[name.slice(dot + 1)] ?? null : null;
}

const START = /[A-Za-z_$@\p{L}]/u;
// Sticky patterns, tried at a position without cutting the line (lines are long, and slicing each
// would copy them over and over).
const NUM = /0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?[a-zA-Z%]*|\.[0-9_]+(?:[eE][+-]?[0-9]+)?/y;
const WORD = /[A-Za-z_$@\p{L}][\w$\p{L}\p{N}]*[?!]?/uy;
const KEY_AFTER = /[ \t]*[:=]/y, CALL_AFTER = /[ \t]*\(/y, PROP_AFTER = /[ \t]*:(?:[ \t]|$)/y;
const TAG = /<\/?[A-Za-z][\w:.-]*/y, ATTR = /[A-Za-z_:@][\w:.@-]*/y;
const at = (re, text, i) => { re.lastIndex = i; const m = re.exec(text); return m ? m[0] : null; };
const follows = (re, text, i) => { re.lastIndex = i; return re.test(text); };
// `#` starts a comment there only at the start or after a space ($#, a#b and URLs aren't comments).
const SPACED_HASH = new Set(["shell", "yaml", "toml"]);
const YAML_WORDS = words("yes no on off");

// Where a string opened with `q` ends in `text` from `i` (its index after the closing quote), or -1
// when it doesn't end on this line. `raw`: no backslash escapes.
function stringEnd(text, i, q, raw) {
  for (let k = i; k < text.length; k++) {
    if (!raw && text[k] === "\\") { k++; continue; }
    if (text.startsWith(q, k)) return k + q.length;
  }
  return -1;
}

/** `text` (one line) cut into spans for family `lang` (languageOf; null: one plain span), going on
 *  from `state` (what the line before left open; null at a file's or hunk's start). Returns
 *  { spans, state }. */
export function tokenize(text, lang, state = null) {
  const f = lang ? FAMILIES[lang] : null;
  if (!f) return { spans: [{ text, cls: "" }], state: null };
  const spans = [];
  // A piece of the line in class `cls`; next to a span of the same class it joins that span.
  const emit = (piece, cls) => {
    if (!piece) return;
    const last = spans.at(-1);
    if (last !== undefined && last.cls === cls) last.text += piece;
    else spans.push({ text: piece, cls });
  };
  let i = 0, open = state;
  // Inside a block comment or a multi-line string from the line before.
  if (open) {
    const end = open.comment ? text.indexOf(open.comment) : stringEnd(text, 0, open.string, open.raw);
    if (end < 0) { emit(text, open.comment ? "comment" : "string"); return { spans: spans.length ? spans : [{ text, cls: "" }], state: open }; }
    const to = open.comment ? end + open.comment.length : end;
    emit(text.slice(0, to), open.comment ? "comment" : "string");
    i = to; open = null;
  }
  const keys = f.keywords ? SETS[f.keywords] : null;
  let tagOpen = false;
  while (i < text.length) {
    const c = text[i];
    const line = f.line.find((m) => text.startsWith(m, i));
    if (line && !(line === "#" && SPACED_HASH.has(lang) && i > 0 && !/\s/.test(text[i - 1]))) { emit(text.slice(i), "comment"); break; }
    const block = f.block.find(([a]) => text.startsWith(a, i));
    if (block) {
      const end = text.indexOf(block[1], i + block[0].length);
      if (end < 0) { emit(text.slice(i), "comment"); open = { comment: block[1] }; break; }
      emit(text.slice(i, end + block[1].length), "comment"); i = end + block[1].length; continue;
    }
    const q = f.markup && !tagOpen ? null : f.strings.find((s) => text.startsWith(s, i));
    if (q) {
      const raw = Boolean(f.raw?.includes(q)), end = stringEnd(text, i + q.length, q, raw);
      if (end < 0) {
        emit(text.slice(i), "string");
        if (f.multi?.includes(q)) open = { string: q, raw };
        break;
      }
      // A key before a colon (JSON, YAML, TOML) is a key, not a value.
      emit(text.slice(i, end), f.keys && follows(KEY_AFTER, text, end) ? "attr" : "string"); i = end; continue;
    }
    if (f.markup) {
      const tag = c === "<" ? at(TAG, text, i) : null;
      if (tag) { emit(tag, "tag"); i += tag.length; tagOpen = true; continue; }
      if (tagOpen && (c === ">" || (c === "/" && text[i + 1] === ">"))) { const t = c === ">" ? ">" : "/>"; emit(t, "tag"); i += t.length; tagOpen = false; continue; }
      const attr = tagOpen ? at(ATTR, text, i) : null;
      if (attr) { emit(attr, "attr"); i += attr.length; continue; }
      emit(c, ""); i++; continue;
    }
    const prev = text[i - 1] ?? "";
    if ((/[0-9]/.test(c) || (c === "." && /[0-9]/.test(text[i + 1] ?? ""))) && !/[\w$]/.test(prev)) {
      const n = at(NUM, text, i) ?? c;
      emit(n, "number"); i += n.length; continue;
    }
    if (START.test(c) && !/[\w$]/.test(prev)) {
      const w = at(WORD, text, i) ?? c, end = i + w.length;
      let cls = "";
      if (f.keys && follows(KEY_AFTER, text, end) && !CONSTANTS.has(w)) cls = "attr";
      else if (CONSTANTS.has(w) || (f.keys && YAML_WORDS.has(w))) cls = "constant";
      else if (keys?.has(f.nocase ? w.toLowerCase() : w)) cls = "keyword";
      else if (f.css && follows(PROP_AFTER, text, end)) cls = "attr";
      else if (f.calls && follows(CALL_AFTER, text, end)) cls = "function";
      else if (f.types && /^[A-Z][a-z0-9]/.test(w)) cls = "type";
      else if (f.types && w.length > 1 && /^[A-Z][A-Z0-9_]+$/.test(w)) cls = "constant";
      emit(w, cls); i = end; continue;
    }
    emit(c, ""); i++;
  }
  return { spans: spans.length ? spans : [{ text: "", cls: "" }], state: open };
}
