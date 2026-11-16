// Every place that awaits another copy's answer (a question, the commit menu, the rebase editor)
// takes it with onPage, so the flow goes on in the page's own call (onpage.js says why).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "git-enhanced", "mods", "git-enhanced");
const code = readdirSync(DIR).filter((f) => f.endsWith(".js")).flatMap((f) => readFileSync(join(DIR, f), "utf8").split("\n").map((l, i) => [`${f}:${i + 1}`, l]))
  .filter(([, l]) => !/^\s*(\/\/|\/?\*)/.test(l));

test("each question's, commit menu's and rebase editor's answer is taken with onPage", () => {
  const asks = code.filter(([, l]) => /questions\.(ask|choose)\(|\bq\.(ask|choose)\(|openRebaseEditor\(/.test(l) && !/^\s*export function/.test(l));
  assert.ok(asks.length >= 6, asks.map(([at]) => at).join(" "));
  assert.deepEqual(asks.filter(([, l]) => !/onPage\(cx, /.test(l)).map(([at, l]) => `${at} ${l.trim().slice(0, 80)}`), []);
  // The commit menu's answer: awaited once, with onPage.
  const menus = code.filter(([, l]) => /= awaitMenu\(\)/.test(l)).map(([at]) => at);
  const awaited = code.filter(([, l]) => /await (onPage\(cx, )?answer\b/.test(l));
  assert.equal(awaited.length, menus.length, `${menus} ${awaited.map(([at]) => at)}`);
  assert.deepEqual(awaited.filter(([, l]) => !/await onPage\(cx, answer\)/.test(l)).map(([at]) => at), []);
});
