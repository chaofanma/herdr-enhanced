import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCommand, quoteWord, joinCommand } from "../../shared/shellwords.js";

// The first tests are shell-words 1.1.1's own (src/lib.rs, MIT; see THIRD_PARTY_NOTICES.md).
const splits = (cases) => { for (const [line, words] of cases) assert.deepEqual(splitCommand(line), words, JSON.stringify(line)); };

test("shell-words: blanks around and between words", () => {
  splits([["", []], ["     a", ["a"]], ["\t\t\t\tbar", ["bar"]], ["\t \nc", ["c"]]]);
  splits([["a  ", ["a"]], ["b\t", ["b"]], ["c\t \n \n \n", ["c"]], ["d\n\n", ["d"]]]);
  splits([["c\ra\r'\r'\r", ["c\ra\r\r\r"]]]);
});

test("shell-words: single quotes keep everything", () => {
  splits([["''", [""]], ["'a'", ["a"]], ["'\\'", ["\\"]], ["' \\ '", [" \\ "]], ["'#'", ["#"]]]);
});

test("shell-words: double quotes, where \\ escapes only $ ` \" \\ and newline", () => {
  splits([
    ['""', [""]], ['""""', [""]], ['"a b c\' d"', ["a b c' d"]], ['"\\a"', ["\\a"]], ['"$"', ["$"]], ['"\\$"', ["$"]],
    ['"`"', ["`"]], ['"\\`"', ["`"]], ['"\\""', ['"']], ['"\\\\"', ["\\"]], ['"\n"', ["\n"]], ['"\\\n"', [""]],
  ]);
});

test("shell-words: unquoted backslashes", () => {
  splits([
    ["\\|\\&\\;", ["|&;"]], ["\\<\\>", ["<>"]], ["\\(\\)", ["()"]], ["\\$", ["$"]], ["\\`", ["`"]], ['\\"', ['"']], ["\\'", ["'"]],
    ["\\\n", []], [" \\\n \n", []], ["a\nb\nc", ["a", "b", "c"]], ["a\\\nb\\\nc", ["abc"]], ["foo bar baz", ["foo", "bar", "baz"]], ["\\🦉", ["🦉"]],
  ]);
  splits([["\\", ["\\"]], [" \\", ["\\"]], ["a\\", ["a\\"]]]);
});

test("shell-words: an unclosed quote is an error (null)", () => {
  for (const line of ["'abc", '"', "'\\", '"\\']) assert.equal(splitCommand(line), null, line);
});

test("shell-words: comments", () => {
  splits([[" x # comment ", ["x"]], [" w1#w2 ", ["w1#w2"]], ["'not really a # comment'", ["not really a # comment"]], [" a # very long comment \n b # another comment", ["a", "b"]]]);
});

test("shell-words: quoting and joining", () => {
  assert.equal(quoteWord(""), "''");
  assert.equal(quoteWord("'"), "''\\'''");
  assert.equal(quoteWord("abc"), "abc");
  assert.equal(quoteWord("a \n  b"), "'a \n  b'");
  assert.equal(quoteWord("X'\nY"), "'X'\\''\nY'");
  assert.equal(quoteWord("~root"), "'~root'");
  assert.equal(joinCommand(["a", "b", "c"]), "a b c");
  assert.equal(joinCommand([" ", "$", "\n"]), "' ' '$' '\n'");
  for (const argv of [["a"], ["python", "-c", "print('Hello world!')"], ["echo", " arg with spaces ", "arg ' with \" quotes"],
    ["even newlines are quoted correctly\n", "\n", "\n\n\t "], ["$", "`test`"], ["cat", "~user/log*"], ["test", "'a \"b", "\"X'"], ["empty", "", "", ""]]) {
    assert.deepEqual(splitCommand(joinCommand(argv)), argv);
  }
});

test("commands people type in the settings window", () => {
  splits([
    ["code -g {file}:{line}", ["code", "-g", "{file}:{line}"]],
    ["open -a 'Visual Studio Code' {path}", ["open", "-a", "Visual Studio Code", "{path}"]],
    ['open -a "Sublime Text" {file}', ["open", "-a", "Sublime Text", "{file}"]],
    ["my\\ editor --wait {file}", ["my editor", "--wait", "{file}"]],
    ["emacsclient -n +{line} {file}", ["emacsclient", "-n", "+{line}", "{file}"]],
    ["  nvim   {file}  ", ["nvim", "{file}"]],
    ['say "it\'s {file}"', ["say", "it's {file}"]],
  ]);
  // Placeholders need no quotes, so a stored command reads back as typed.
  assert.equal(joinCommand(["code", "-g", "{file}:{line}"]), "code -g {file}:{line}");
  assert.equal(joinCommand(["open", "-a", "Visual Studio Code", "{path}"]), "open -a 'Visual Studio Code' {path}");
  assert.equal(splitCommand('say "unclosed'), null);
});
