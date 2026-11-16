import { test } from "node:test";
import assert from "node:assert/strict";
import { mod } from "./mod.mjs";

const { languageOf, tokenize } = await mod("tokens.js");

// The classes of a line, as "cls:text" for the colored spans.
const marks = (text, lang, state = null) => {
  const r = tokenize(text, lang, state);
  assert.equal(r.spans.map((s) => s.text).join(""), text, "the spans cover the line exactly");
  return { marks: r.spans.filter((s) => s.cls).map((s) => `${s.cls}:${s.text}`), state: r.state };
};

test("languageOf: by extension, by name, plain otherwise", () => {
  assert.equal(languageOf("src/app.tsx"), "js");
  assert.equal(languageOf("lib/a.rs"), "rust");
  assert.equal(languageOf("x/y.PY"), "python");
  assert.equal(languageOf("Makefile"), "shell");
  assert.equal(languageOf("Dockerfile.dev"), "shell");
  assert.equal(languageOf("conf/.env"), "shell");
  assert.equal(languageOf("data.yml"), "yaml");
  assert.equal(languageOf("App.vue"), "markup");
  assert.equal(languageOf("README"), null);
  assert.equal(languageOf("notes.md"), null);
  assert.equal(languageOf(""), null);
});

test("JS: keywords, calls, numbers, strings, comments; a template string over lines", () => {
  assert.deepEqual(marks('const x = foo(1.5, "s") // note', "js").marks, ["keyword:const", "function:foo", "number:1.5", 'string:"s"', "comment:// note"]);
  const a = marks("let t = `one", "js");
  assert.deepEqual(a.marks, ["keyword:let", "string:`one"]);
  const b = marks("two ${y}` + 0x1f", "js", a.state);
  assert.deepEqual(b.marks, ["string:two ${y}`", "number:0x1f"]);
  assert.equal(b.state, null);
  assert.deepEqual(marks('a = "esc \\" still" + b', "js").marks, ['string:"esc \\" still"']);
  assert.deepEqual(marks("class Foo extends Bar {}", "js").marks, ["keyword:class", "type:Foo", "keyword:extends", "type:Bar"]);
  assert.deepEqual(marks("if (x2 && MAX_SIZE) return null;", "js").marks, ["keyword:if", "constant:MAX_SIZE", "keyword:return", "constant:null"]);
});

test("block comments and triple-quoted strings carry over to the next line", () => {
  const c1 = marks("int a = 0; /* start", "c");
  assert.deepEqual(c1.state, { comment: "*/" });
  assert.deepEqual(marks("still inside", "c", c1.state).marks, ["comment:still inside"]);
  assert.deepEqual(marks("end */ return a;", "c", c1.state).marks, ["comment:end */", "keyword:return"]);
  const p1 = marks('def f(a):  """doc', "python");
  assert.deepEqual(p1.marks, ["keyword:def", "function:f", 'string:"""doc']);
  assert.deepEqual(marks('more""" # c', "python", p1.state).marks, ['string:more"""', "comment:# c"]);
});

test("markup: tags, attributes and their values; comments", () => {
  assert.deepEqual(marks('<div class="x">text</div>', "markup").marks, ["tag:<div", "attr:class", 'string:"x"', "tag:>", "tag:</div>"], "a span goes on while its class does");
  assert.deepEqual(marks("<!-- a note --> <br/>", "markup").marks, ["comment:<!-- a note -->", "tag:<br/>"]);
  assert.deepEqual(marks('it\'s "quoted" text', "markup").marks, [], "outside a tag, quotes are text");
});

test("data files: keys, values and comments", () => {
  assert.deepEqual(marks('{"key": 12, "on": true, "s": "v"}', "json").marks, ['attr:"key"', "number:12", 'attr:"on"', "constant:true", 'attr:"s"', 'string:"v"']);
  assert.deepEqual(marks("name: yes # why", "yaml").marks, ["attr:name", "constant:yes", "comment:# why"]);
  assert.deepEqual(marks("color: x#y", "yaml").marks, ["attr:color"], "a # inside a value is no comment");
  assert.deepEqual(marks('version = "1.0"', "toml").marks, ["attr:version", 'string:"1.0"']);
});

test("shell, SQL and CSS", () => {
  assert.deepEqual(marks("echo $# ${#x} # real", "shell").marks, ["keyword:echo", "comment:# real"]);
  assert.deepEqual(marks("select id from t where x = 1", "sql").marks, ["keyword:select", "keyword:from", "keyword:where", "number:1"]);
  assert.deepEqual(marks("a:hover { color: red; margin: 4px }", "css").marks, ["attr:color", "attr:margin", "number:4px"]);
});

test("plain text and odd input", () => {
  assert.deepEqual(tokenize("anything at all", null), { spans: [{ text: "anything at all", cls: "" }], state: null });
  assert.deepEqual(tokenize("", "js").spans, [{ text: "", cls: "" }]);
  assert.deepEqual(marks("한국어 = 1", "python").marks, ["number:1"]);
  // A long line is scanned without trouble.
  const long = 'x = "'.padEnd(5000, "a") + '"';
  assert.equal(marks(long, "python").marks.length, 1);
});
