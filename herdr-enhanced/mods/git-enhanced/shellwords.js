// A command line as the person types it in the settings window, split into words the way a Unix
// shell splits them (spaces; "double" and 'single' quotes; backslashes), and words joined back into
// a line that splits to the same words (to show a stored command in a field). Only quote removal:
// no $variables, ~, globs or operators; a word that starts with # starts a comment, as in sh.
// Pure, so it can be tested.

// Adapted from shell-words 1.1.1 src/lib.rs (MIT), https://github.com/tmiasko/shell-words:
// splitCommand is its split() state machine, quoteWord / joinCommand its quote() / join().

const BLANK = new Set([" ", "\t", "\n"]);

// The words of a command line, or null when a quote isn't closed.
export function splitCommand(line) {
  const words = [];
  let word = "", state = "delimiter";
  for (const c of [...String(line ?? ""), null]) {             // null: the end of the line
    switch (state) {
      case "delimiter":                                         // between words
        if (c === null) return words;
        if (c === "'") state = "single";
        else if (c === '"') state = "double";
        else if (c === "\\") state = "backslash";
        else if (c === "#") state = "comment";
        else if (!BLANK.has(c)) { word += c; state = "unquoted"; }
        break;
      case "backslash":                                         // after a backslash, before a word
        if (c === null) { words.push(word + "\\"); return words; }
        if (c === "\n") state = "delimiter";
        else { word += c; state = "unquoted"; }
        break;
      case "unquoted":
        if (c === null) { words.push(word); return words; }
        if (c === "'") state = "single";
        else if (c === '"') state = "double";
        else if (c === "\\") state = "unquoted-backslash";
        else if (BLANK.has(c)) { words.push(word); word = ""; state = "delimiter"; }
        else word += c;
        break;
      case "unquoted-backslash":
        if (c === null) { words.push(word + "\\"); return words; }
        if (c !== "\n") word += c;                              // a backslash-newline joins lines
        state = "unquoted";
        break;
      case "single":
        if (c === null) return null;
        if (c === "'") state = "unquoted";
        else word += c;
        break;
      case "double":
        if (c === null) return null;
        if (c === '"') state = "unquoted";
        else if (c === "\\") state = "double-backslash";
        else word += c;
        break;
      case "double-backslash":                                  // inside "…", \ escapes only $ ` " \ and newline
        if (c === null) return null;
        if (c === "$" || c === "`" || c === '"' || c === "\\") word += c;
        else if (c !== "\n") word += "\\" + c;
        state = "double";
        break;
      case "comment":
        if (c === null) return words;
        if (c === "\n") state = "delimiter";
        break;
    }
  }
  return words;
}

const SPECIAL = new Set([..."|&;<>()$`\\\" \t*?[#~=%'\n"]);

// One word as the shell reads it back: as it is when nothing in it is special, else in single quotes.
export function quoteWord(word) {
  const s = String(word);
  if (s === "") return "''";
  if (![...s].some((c) => SPECIAL.has(c))) return s;
  return `'${s.replaceAll("'", "'\\''")}'`;
}

// Words as one command line: splitCommand(joinCommand(words)) gives the same words.
export const joinCommand = (words) => words.map(quoteWord).join(" ");
