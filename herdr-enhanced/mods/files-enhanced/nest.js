// File nesting (the Files setting nesting, rules in settings.nest): related files listed under their
// parent file, as VS Code's file nesting setting does. A rule's key is a name ("package.json") or a
// pattern with one * ("*.ts"); its values are child names where $(base) is the parent's name without its
// extension ("a" for a.ts; $(capture), what * matched, works too) and * matches any run of characters.
// Pure: tested in test/files-enhanced/nest.test.mjs.
//
// Adapted from microsoft/vscode src/vs/workbench/contrib/files/common/explorerFileNestingTrie.ts (MIT):
// the double-ended trie, with $(base) added as another name for $(basename), and nest() keeping one
// parent per child (VS Code may list a child under two).

function attributesOf(filename) {
  const lastDot = filename.lastIndexOf(".");
  return lastDot < 1 ? { basename: filename, extname: "" } : { basename: filename.slice(0, lastDot), extname: filename.slice(lastDot + 1) };
}

const TOKENS = /\$[({](capture|basename|base|dirname|extname)[)}]/g;

class SubstitutionString {
  constructor(pattern) {
    this.tokens = [];
    TOKENS.lastIndex = 0;
    let token, last = 0;
    while ((token = TOKENS.exec(pattern))) {
      this.tokens.push(pattern.slice(last, token.index));
      this.tokens.push({ capture: token[1] === "base" ? "basename" : token[1] });
      last = token.index + token[0].length;
    }
    if (last !== pattern.length) this.tokens.push(pattern.slice(last));
  }
  substitute(attributes, capture) {
    return this.tokens.map(t => (typeof t === "string" ? t : t.capture === "capture" ? capture || "" : t.capture === "dirname" ? "" : attributes[t.capture])).join("");
  }
}

class SufTrie {
  constructor() { this.star = []; this.epsilon = []; this.map = new Map(); this.hasItems = false; }
  add(key, value) {
    this.hasItems = true;
    if (key === "*") this.star.push(new SubstitutionString(value));
    else if (key === "") this.epsilon.push(new SubstitutionString(value));
    else {
      const tail = key[key.length - 1], rest = key.slice(0, -1);
      if (tail === "*") throw new Error(`Unexpected star in SufTrie key: ${key}`);
      let next = this.map.get(tail);
      if (!next) this.map.set(tail, (next = new SufTrie()));
      next.add(rest, value);
    }
  }
  get(key, attributes) {
    const results = [];
    if (key === "") results.push(...this.epsilon.map(ss => ss.substitute(attributes)));
    if (this.star.length) results.push(...this.star.map(ss => ss.substitute(attributes, key)));
    const next = this.map.get(key[key.length - 1]);
    if (next) results.push(...next.get(key.slice(0, -1), attributes));
    return results;
  }
}

class PreTrie {
  constructor() { this.value = new SufTrie(); this.map = new Map(); }
  add(key, value) {
    if (key === "" || key[0] === "*") this.value.add(key, value);
    else {
      let next = this.map.get(key[0]);
      if (!next) this.map.set(key[0], (next = new PreTrie()));
      next.add(key.slice(1), value);
    }
  }
  get(key, attributes) {
    const results = [...this.value.get(key, attributes)];
    const next = this.map.get(key[0]);
    if (next) results.push(...next.get(key.slice(1), attributes));
    return results;
  }
}

// rules: { parentPattern: [childPatterns] } (settings.nest). A pattern with more than one * can't be
// read by the trie and is left out.
export class Nesting {
  constructor(rules) {
    this.root = new PreTrie();
    for (const [parent, children] of Object.entries(rules ?? {})) {
      if ((parent.match(/\*/g) ?? []).length > 1) continue;
      for (const child of children ?? []) {
        if (typeof child !== "string" || (child.match(/\*/g) ?? []).length > 1) continue;
        try { this.root.add(parent, child); } catch { /* a * where the trie can't take one */ }
      }
    }
  }

  // files: names in one folder, in the order listed. Returns a Map of parent name -> its children's
  // names (in that order); a child of a child goes to the top one, and a child with two parents to
  // the first listed.
  nest(files) {
    const parentFinder = new PreTrie();
    for (const potentialParent of files) {
      for (const child of this.root.get(potentialParent, attributesOf(potentialParent))) parentFinder.add(child, potentialParent);
    }
    const order = new Map(files.map((f, i) => [f, i]));
    const rootsOf = (file, seen = new Set()) => {
      if (seen.has(file)) return [];
      seen.add(file);
      const ancestors = new Set(parentFinder.get(file, attributesOf(file)));
      ancestors.delete(file);
      for (const a of [...ancestors]) if (!order.has(a)) ancestors.delete(a);
      if (!ancestors.size) return [file];
      return [...ancestors].sort((a, b) => order.get(a) - order.get(b)).flatMap(a => rootsOf(a, seen));
    };
    const out = new Map();
    for (const file of files) {
      const roots = rootsOf(file), top = roots.length ? roots.sort((a, b) => order.get(a) - order.get(b))[0] : file;
      if (top === file) { if (!out.has(file)) out.set(file, []); continue; }
      if (!out.has(top)) out.set(top, []);
      out.get(top).push(file);
    }
    for (const [k, v] of out) if (!v.length) out.delete(k);
    return out;
  }
}
